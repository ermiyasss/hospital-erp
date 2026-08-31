/* ==========================================================================
   MediTrack Hospital ERP - Messages

   A hospital messenger with four kinds of conversation:

     Announcements   hospital-wide channel; admins post, everyone reads.
     Role chats      one group per role, created automatically and kept in
                     sync with the staff directory, so every account that
                     holds the role is a member the moment it exists.
     Group chats     created by anyone. The creator (or an admin) can delete
                     the group for everyone; other members can leave it.
     Individual      one-to-one with a colleague.

   Every conversation can also be removed from this workstation with
   "Delete chat". That leaves a dated notice in the thread for the other
   participants ("Abebe deleted the chat on Sunday, Aug 30, 2026 at 8:12 PM")
   and the chat comes back by itself if anyone writes again.

   Images and files attach via the paperclip and can be saved to Inventory
   from the thread.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var session = window.MediSession;

    var messages = [];
    var staff = [];
    var groups = [];
    var hidden = [];              /* [{ username, key, at }] — chats removed here */
    var active = null;            /* { type:'user'|'group'|'announce', ... } */
    var currentConvs = [];
    var searchTerm = '';
    var pending = [];             /* attachments waiting to send */

    /* Roles a group is auto-created for (kept in sync with js/session.js). */
    var ROLE_KEYS = ['admin', 'doctor', 'nurse', 'billing', 'lab'];
    var ROLE_GROUP_NAMES = {
        admin: 'All Administrators',
        doctor: 'All Doctors',
        nurse: 'All Nurses',
        billing: 'All Billing Staff',
        lab: 'All Lab Staff'
    };

    /* Sidebar sections, in display order. Collapsed state is a per-user
       preference, so it lives in this browser rather than in hospital data. */
    var SECTIONS = [
        { id: 'announce', label: 'Announcements' },
        { id: 'role', label: 'Role chats' },
        { id: 'group', label: 'Group chats' },
        { id: 'user', label: 'Individual chats' }
    ];
    var collapsed = { announce: false, role: false, group: false, user: false };

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }
    function me() { var s = session.read() || {}; return { user: String(s.user || ''), name: String(s.name || ''), role: String(s.role || '') }; }
    function isAdmin() { return me().role === 'admin'; }
    function roleLabel(key) {
        try { var d = session.roleDefinition(key); if (d && d.short) return d.short; } catch (e) {}
        return key || '';
    }
    function lower(v) { return String(v || '').toLowerCase(); }
    function debounce(fn, wait) {
        var t = null;
        return function () {
            var args = arguments, self = this;
            if (t) clearTimeout(t);
            t = setTimeout(function () { t = null; fn.apply(self, args); }, wait);
        };
    }
    function timeOf(m) { var t = store.parseDate ? store.parseDate(m.time) : new Date(m.time); return t && !isNaN(t.getTime()) ? t.getTime() : 0; }

    /* ==================================================================
       Preferences: collapsed sections
       ================================================================== */
    function sectionPrefKey() { return 'meditrack_msg_sections_' + lower(me().user || 'anon'); }

    function loadSectionPrefs() {
        var raw = store.rawGet(sectionPrefKey());
        if (!raw) return;
        try {
            var saved = JSON.parse(raw);
            if (saved && typeof saved === 'object') {
                SECTIONS.forEach(function (s) { collapsed[s.id] = !!saved[s.id]; });
            }
        } catch (e) {}
    }

    function saveSectionPrefs() { store.rawSet(sectionPrefKey(), JSON.stringify(collapsed)); }

    /* ==================================================================
       Data
       ================================================================== */
    function loadGroups() { groups = store.read(store.KEYS.groups) || []; }

    /* One group per role, always present, always holding every active account
       that carries the role. Anything that creates, renames or deactivates a
       colleague is picked up the next time this page loads or polls. */
    function syncRoleGroups() {
        var changed = false;
        var list = groups.slice();

        ROLE_KEYS.forEach(function (key) {
            var members = staff
                .filter(function (s) { return s.active !== false && lower(s.role) === key; })
                .map(function (s) { return { username: s.username, name: s.name }; })
                .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

            var g = null;
            for (var i = 0; i < list.length; i++) {
                if (list[i] && lower(list[i].roleKey) === key) { g = list[i]; break; }
            }

            var name = ROLE_GROUP_NAMES[key] || (roleLabel(key) + ' staff');

            if (!g) {
                list.push({
                    id: 'role_' + key,
                    name: name,
                    description: 'Everyone with the ' + roleLabel(key) + ' role · membership is automatic',
                    createdBy: 'system',
                    roleGroup: true,
                    roleKey: key,
                    members: members,
                    time: new Date().toISOString()
                });
                changed = true;
                return;
            }
            if (String(g.name || '') !== name) { g.name = name; changed = true; }
            if (g.roleGroup !== true) { g.roleGroup = true; changed = true; }
            if (JSON.stringify(g.members || []) !== JSON.stringify(members)) { g.members = members; changed = true; }
        });

        if (changed) {
            groups = list;
            store.write(store.KEYS.groups, groups);
        }
    }

    function groupOf(id) {
        for (var i = 0; i < groups.length; i++) {
            if (groups[i] && String(groups[i].id) === String(id)) return groups[i];
        }
        return null;
    }

    function isRoleGroup(g) { return !!(g && g.roleGroup); }

    function iAmMember(g) {
        if (!g) return false;
        var u = lower(me().user);
        return (g.members || []).some(function (m) { return lower(m.username) === u; });
    }

    /* The creator or an administrator may delete a group for everybody. */
    function canManageGroup(g) {
        return !!g && !isRoleGroup(g) && (lower(g.createdBy) === lower(me().user) || isAdmin());
    }

    function createGroup(name, memberUsernames) {
        var who = me();
        var id = 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        var list = groups.slice();
        var members = [{ username: who.user, name: who.name }];
        (memberUsernames || []).forEach(function (u) {
            if (lower(u) === lower(who.user)) return;
            if (members.some(function (m) { return lower(m.username) === lower(u); })) return;
            var s = staff.filter(function (x) { return lower(x.username) === lower(u); })[0];
            members.push({ username: u, name: s ? s.name : u });
        });
        var desc = (byId('newGroupDesc') ? byId('newGroupDesc').value : '').trim();
        list.push({ id: id, name: name, description: desc, createdBy: who.user, members: members, time: new Date().toISOString() });
        groups = list;
        store.write(store.KEYS.groups, groups);
        return groupOf(id);
    }

    /* ==================================================================
       Chats this workstation removed
       ================================================================== */
    function hiddenAt(key) {
        var u = lower(me().user);
        for (var i = 0; i < hidden.length; i++) {
            var h = hidden[i];
            if (h && h.key === key && lower(h.username) === u) return Number(h.at) || 0;
        }
        return 0;
    }

    /* A chat stays hidden until somebody writes in it again. */
    function isHidden(conv) {
        var at = hiddenAt(conv.key);
        if (!at) return false;
        var last = lastMessage(conv);
        return !(last && timeOf(last) > at);
    }

    function hideConversation(key) {
        var who = me();
        var list = (store.read(store.KEYS.chatHidden) || []).filter(function (h) {
            return !(h && h.key === key && lower(h.username) === lower(who.user));
        });
        list.push({ username: who.user, key: key, at: Date.now() });
        store.write(store.KEYS.chatHidden, list);
        hidden = list.filter(function (h) { return h && lower(h.username) === lower(who.user); });
    }

    /* ==================================================================
       Conversations
       ================================================================== */
    function buildConversations() {
        var who = me();
        var list = [];

        list.push({ type: 'announce', key: 'announce', label: 'Announcements', section: 'announce' });

        /* Role chats — auto-created, one per role, shown to everyone. */
        ROLE_KEYS.forEach(function (key) {
            var g = groups.filter(function (x) { return lower(x.roleKey) === key; })[0];
            if (!g) return;
            list.push({
                type: 'group', key: 'g_' + g.id, label: g.name, groupId: g.id,
                section: 'role', roleGroup: true, roleKey: key
            });
        });

        /* Group chats you belong to, most recently used first. */
        groups
            .filter(function (g) { return !isRoleGroup(g) && iAmMember(g); })
            .map(function (g) {
                return { type: 'group', key: 'g_' + g.id, label: g.name, groupId: g.id, section: 'group' };
            })
            .sort(function (a, b) {
                var ta = lastMessage(a), tb = lastMessage(b);
                var d = timeOf(tb) - timeOf(ta);
                return d !== 0 ? d : String(a.label).localeCompare(String(b.label));
            })
            .forEach(function (c) { list.push(c); });

        staff
            .filter(function (s) { return s.active !== false && lower(s.username) !== lower(who.user); })
            .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
            .forEach(function (s) {
                list.push({
                    type: 'user', key: 'u_' + s.username, label: s.name,
                    username: s.username, role: lower(s.role), section: 'user'
                });
            });

        return list.filter(function (c) { return !isHidden(c); });
    }

    function threadFor(conv) {
        var who = me();
        if (conv.type === 'announce') {
            return messages.filter(function (m) { return m.toType === 'all'; });
        }
        if (conv.type === 'group') {
            var g = groupOf(conv.groupId);
            return messages.filter(function (m) {
                if (m.toType === 'group' && String(m.groupId) === String(conv.groupId)) return true;
                if (m.toType === 'role' && m.toRole === 'group:' + conv.groupId) return true;
                /* Older role broadcasts land in the matching role chat. */
                if (g && isRoleGroup(g) && m.toType === 'role' && lower(m.toRole) === lower(g.roleKey)) return true;
                return false;
            });
        }
        var u = conv.username;
        return messages.filter(function (m) {
            if (m.toType !== 'user') return false;
            var a = lower(m.fromUsername), b = lower(m.toUsername);
            return (a === lower(who.user) && b === lower(u)) || (a === lower(u) && b === lower(who.user));
        });
    }

    function lastMessage(conv) {
        var t = threadFor(conv);
        return t.length ? t[t.length - 1] : null;
    }

    function unreadCount(conv) {
        var who = me();
        if (conv.type === 'announce') return 0;
        return threadFor(conv).filter(function (m) {
            if (m.kind === 'system') return false;
            if (lower(m.fromUsername) === lower(who.user)) return false;
            return timeOf(m) > store.lastMessageReadAt();
        }).length;
    }

    /* ==================================================================
       Render: conversation list
       ================================================================== */
    function avatarFor(conv) {
        if (conv.type === 'announce') {
            return '<span class="avatar avatar-channel">' + icon('megaphone', 16) + '</span>';
        }
        if (conv.type === 'group') {
            return '<span class="avatar ' + (conv.roleGroup ? 'avatar-role' : 'avatar-group') + '">' +
                icon(conv.roleGroup ? 'shield-check' : 'users', 16) + '</span>';
        }
        return '<span class="avatar avatar-person">' + icon('user', 16) + '</span>';
    }

    function convSub(conv) {
        var last = lastMessage(conv);
        if (!last) {
            return conv.type === 'announce' ? 'Hospital-wide messages from admins'
                : conv.type === 'group' ? 'No messages yet'
                : 'No messages yet';
        }
        var text = last.body
            ? last.body
            : (last.attachments && last.attachments.length ? '📎 ' + last.attachments.length + ' attachment' : '');
        if (last.kind === 'system') return text;
        return (lower(last.fromUsername) === lower(me().user) ? 'You: ' : '') + text;
    }

    function convMeta(conv) {
        if (conv.type === 'user') return esc(roleLabel(conv.role));
        if (conv.type === 'announce') return 'Everyone · admins post';
        var g = groupOf(conv.groupId);
        if (conv.roleGroup) return (g ? g.members.length : 0) + ' members · automatic';
        return (g ? g.members.length : 0) + ' members';
    }

    function convRow(c) {
        var last = lastMessage(c);
        var unread = unreadCount(c);
        var time = last ? store.relativeTime(last.time) : '';
        var preview = convSub(c);
        return '<div class="msg-conv' + (active && active.key === c.key ? ' active' : '') + '" data-key="' + esc(c.key) + '">' +
            avatarFor(c) +
            '<span class="msg-conv-body">' +
                '<span class="msg-conv-top">' +
                    '<span class="msg-conv-name">' + esc(c.label) + '</span>' +
                    (time ? '<span class="msg-conv-time">' + esc(time) + '</span>' : '') +
                '</span>' +
                '<span class="msg-conv-role">' + convMeta(c) + '</span>' +
                '<span class="msg-conv-top">' +
                    '<span class="msg-conv-sub">' + esc(preview) + '</span>' +
                    (unread ? '<span class="msg-conv-badge">' + unread + '</span>' : '') +
                '</span>' +
            '</span>' +
        '</div>';
    }

    function matchesSearch(c) {
        if (!searchTerm) return true;
        var q = searchTerm.toLowerCase();
        return lower(c.label).indexOf(q) !== -1 || lower(convSub(c)).indexOf(q) !== -1;
    }

    function renderList() {
        var host = byId('msgConvList');
        if (!host) return;
        currentConvs = buildConversations();

        var html = SECTIONS.map(function (sec) {
            var items = currentConvs.filter(function (c) {
                return c.section === sec.id && matchesSearch(c);
            });
            /* While searching, empty sections are noise — hide them. */
            if (!items.length) return '';
            var isCollapsed = !!collapsed[sec.id];
            return '<div class="msg-sec' + (isCollapsed ? ' collapsed' : '') + '" data-sec="' + esc(sec.id) + '">' +
                '<button type="button" class="msg-sec-head" data-sec-toggle="' + esc(sec.id) + '"' +
                    ' aria-expanded="' + (isCollapsed ? 'false' : 'true') + '">' +
                    '<span class="ico msg-sec-chevron" data-icon="chevron-down" data-icon-size="13"></span>' +
                    '<span class="msg-sec-title">' + esc(sec.label) + '</span>' +
                    '<span class="msg-sec-count">' + items.length + '</span>' +
                '</button>' +
                '<div class="msg-sec-items">' + items.map(convRow).join('') + '</div>' +
            '</div>';
        }).join('');

        host.innerHTML = html || '<div class="empty-state" style="padding:18px 10px"><p>No conversations found</p></div>';

        ui.qsa('.msg-conv', host).forEach(function (el) {
            el.addEventListener('click', function () {
                var conv = currentConvs.filter(function (c) { return c.key === el.getAttribute('data-key'); })[0];
                if (conv) openConversation(conv);
            });
        });
        ui.qsa('[data-sec-toggle]', host).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-sec-toggle');
                collapsed[id] = !collapsed[id];
                saveSectionPrefs();
                renderList();
            });
        });
        if (window.MediIcons) window.MediIcons.hydrate(host);
    }

    /* ==================================================================
       Render: chat pane
       ================================================================== */
    function openConversation(conv) {
        active = conv;
        pending = [];
        renderPending();
        renderList();
        renderHead();
        renderThread();
        var input = byId('msgInput');
        if (input) { input.focus(); input.style.height = 'auto'; }
        var sendBtn = byId('msgSendBtn');
        if (sendBtn) sendBtn.disabled = true;
    }

    function clearChatPane() {
        active = null;
        renderHead();
        renderThread();
        renderList();
    }

    function chatMenuItems() {
        if (!active || active.type === 'announce') return [];
        var items = [];
        if (active.type === 'group') {
            var g = groupOf(active.groupId);
            if (g && !isRoleGroup(g)) {
                /* An administrator may delete any group but still needs a way
                   out of one they were added to, so both can be offered. */
                if (canManageGroup(g)) {
                    items.push({ act: 'deleteGroup', icon: 'trash', label: 'Delete group for everyone', danger: true });
                }
                if (iAmMember(g)) {
                    items.push({ act: 'leaveGroup', icon: 'logout', label: 'Leave group' });
                }
            }
        }
        items.push({ act: 'deleteChat', icon: 'trash', label: 'Delete chat', danger: true });
        return items;
    }

    function renderHead() {
        var host = byId('msgChatHead');
        if (!host) return;
        if (!active) {
            host.innerHTML = '<span class="msg-chat-head-info"><strong>No conversation selected</strong>' +
                '<span>Choose a chat on the left, or start a new group.</span></span>';
            if (window.MediIcons) window.MediIcons.hydrate(host);
            return;
        }

        var head = '';
        if (active.type === 'announce') {
            head =
                '<span class="avatar avatar-channel">' + icon('megaphone', 18) + '</span>' +
                '<span class="msg-chat-head-info"><strong>Announcements</strong>' +
                '<span>Posted by administrators · visible to everyone</span></span>' +
                (isAdmin() ? '<span class="badge status-awaiting">You can post</span>'
                           : '<span class="badge" style="background:var(--surface-sunken);color:var(--text-faint)">Read only</span>');
        } else if (active.type === 'group') {
            var g = groupOf(active.groupId);
            head =
                '<span class="avatar ' + (active.roleGroup ? 'avatar-role' : 'avatar-group') + '">' +
                    icon(active.roleGroup ? 'shield-check' : 'users', 18) + '</span>' +
                '<span class="msg-chat-head-info"><strong>' + esc(active.label) + '</strong>' +
                '<span>' + (g ? g.members.length : 0) + ' members' +
                    (g && isRoleGroup(g) ? ' · membership follows the role'
                                         : (g && g.description ? ' · ' + esc(g.description) : '')) +
                '</span></span>';
        } else {
            head =
                '<span class="avatar avatar-person">' + icon('user', 18) + '</span>' +
                '<span class="msg-chat-head-info"><strong>' + esc(active.label) + '</strong>' +
                '<span>' + esc(roleLabel(active.role)) + (active.username ? ' · @' + esc(active.username) : '') + '</span></span>';
        }

        var items = chatMenuItems();
        if (items.length) {
            head += '<span class="msg-chat-actions">' +
                '<button type="button" class="msg-icon-btn" id="msgMoreBtn" title="Chat actions" aria-label="Chat actions">' +
                    icon('more', 16) +
                '</button></span>';
        }

        host.innerHTML = head;
        if (window.MediIcons) window.MediIcons.hydrate(host);

        var moreBtn = byId('msgMoreBtn');
        if (moreBtn) {
            moreBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                openChatMenu(moreBtn, items);
            });
        }
    }

    function canCompose() {
        if (!active) return false;
        if (active.type === 'announce') return isAdmin();
        return true;
    }

    function renderThread() {
        var host = byId('msgThread');
        if (!host) return;
        if (!active) {
            host.innerHTML = '<div class="empty-state"><span class="empty-state-icon"><span class="ico" data-icon="message" data-icon-size="24"></span></span><p>Select a conversation to start</p><span>Pick a role chat, a group or a colleague on the left.</span></div>';
            setComposeEnabled(false);
            return;
        }

        if (active.type === 'announce' && !isAdmin()) {
            var t = threadFor(active);
            if (!t.length) {
                host.innerHTML = '<div class="empty-state"><span class="empty-state-icon"><span class="ico" data-icon="megaphone" data-icon-size="24"></span></span><p>No announcements yet</p><span>Admins post hospital-wide messages here.</span></div>';
                setComposeEnabled(false);
                return;
            }
        }

        var thread = threadFor(active).slice().sort(function (a, b) { return timeOf(a) - timeOf(b); });
        if (!thread.length) {
            host.innerHTML = '<div class="empty-state"><span class="empty-state-icon"><span class="ico" data-icon="message" data-icon-size="24"></span></span><p>No messages yet</p><span>Send the first message below.</span></div>';
            setComposeEnabled(canCompose());
            return;
        }

        var who = me();
        var lastDay = '';
        var html = '';
        thread.forEach(function (m) {
            var day = store.formatDate(m.time);
            if (day !== lastDay) {
                html += '<div class="msg-day-sep"><span>' + esc(day) + '</span></div>';
                lastDay = day;
            }

            /* Notices (someone deleted the chat, left a group) read as a
               centred line rather than a bubble from one side. */
            if (m.kind === 'system') {
                html += '<div class="msg-system"><span>' + esc(m.body) + '</span></div>';
                return;
            }

            var mine = lower(m.fromUsername) === lower(who.user);
            var author = '';
            if (!mine && active.type !== 'user') {
                var s = staff.filter(function (x) { return lower(x.username) === lower(m.fromUsername); })[0];
                author = '<div class="msg-meta" style="margin:0 0 4px"><strong style="font-size:11px;color:var(--gray-muted)">' +
                    esc(m.fromName || (s ? s.name : (m.fromUsername || 'Unknown'))) + '</strong></div>';
            }
            html += '<div class="msg-row' + (mine ? ' mine' : '') + '" data-mid="' + esc(m.id) + '">' +
                '<div class="msg-bubble">' +
                    author +
                    (m.body ? '<div class="msg-text">' + esc(m.body) + '</div>' : '') +
                    renderAttachments(m) +
                    '<div class="msg-meta"><span class="t">' + esc(store.formatTime(m.time)) + '</span></div>' +
                '</div>' +
            '</div>';
        });
        host.innerHTML = html;
        if (window.MediIcons) window.MediIcons.hydrate(host);
        host.scrollTop = host.scrollHeight;

        setComposeEnabled(canCompose());

        store.markMessagesRead();
        bindThreadEvents();
    }

    function setComposeEnabled(on) {
        var input = byId('msgInput');
        var sendBtn = byId('msgSendBtn');
        var attachBtn = byId('msgAttachBtn');
        if (input) { input.disabled = !on; input.placeholder = on ? 'Write a message…' : 'You cannot post here'; }
        if (sendBtn) sendBtn.disabled = !on || !(input && input.value.trim()) && !pending.length;
        if (attachBtn) attachBtn.disabled = !on;
    }

    function renderAttachments(m) {
        if (!m.attachments || !m.attachments.length) return '';
        return '<div class="msg-attach">' + m.attachments.map(function (a, i) {
            if (a.kind === 'image') {
                return '<img class="msg-attach-img" src="' + esc(a.data) + '" alt="' + esc(a.name) + '" data-msg="' + esc(m.id) + '" data-idx="' + i + '" />';
            }
            return '<div class="msg-file" data-msg="' + esc(m.id) + '" data-idx="' + i + '">' +
                '<span class="ico" data-icon="file-text" data-icon-size="20"></span>' +
                '<span class="msg-file-name">' + esc(a.name) + '</span>' +
                '<span class="msg-file-size">' + (a.size ? Math.round(a.size / 1024) + ' KB' : '') + '</span>' +
                '<span class="ico" data-icon="download" data-icon-size="15" style="cursor:pointer" data-dl="1"></span>' +
                '</div>';
        }).join('') + '</div>';
    }

    /* ==================================================================
       Compose
       ================================================================== */
    function addPending(file) {
        var reader = new FileReader();
        var isImage = /^image\//.test(file.type);
        reader.onload = function () {
            pending.push({ kind: isImage ? 'image' : 'file', name: file.name, mime: file.type, size: file.size, data: String(reader.result) });
            renderPending();
            var sendBtn = byId('msgSendBtn');
            var input = byId('msgInput');
            if (sendBtn && input && input.value.trim()) sendBtn.disabled = false;
        };
        reader.readAsDataURL(file);
    }

    function renderPending() {
        var host = byId('msgPending');
        if (!host) return;
        host.innerHTML = pending.map(function (p, i) {
            return '<span class="chip"><span class="ico" data-icon="' + (p.kind === 'image' ? 'image' : 'file-text') + '" data-icon-size="13"></span>' +
                '<span class="nm">' + esc(p.name) + '</span>' +
                '<span class="x" data-idx="' + i + '"><span class="ico" data-icon="close" data-icon-size="12"></span></span></span>';
        }).join('');
        ui.qsa('.x', host).forEach(function (el) {
            el.addEventListener('click', function () {
                pending.splice(Number(el.getAttribute('data-idx')), 1);
                renderPending();
                var sendBtn = byId('msgSendBtn');
                var input = byId('msgInput');
                if (sendBtn && input && !input.value.trim() && !pending.length) sendBtn.disabled = true;
            });
        });
        if (window.MediIcons) window.MediIcons.hydrate(host);
    }

    function send() {
        var input = byId('msgInput');
        var text = input ? input.value.trim() : '';
        if (!text && !pending.length) return;
        if (!active) return;
        if (!canCompose()) return;

        var payload = { toType: 'user', body: text, attachments: pending.slice() };
        if (active.type === 'user') {
            payload.toType = 'user';
            payload.toUsername = active.username;
            payload.toName = active.label;
        } else if (active.type === 'group') {
            payload.toType = 'group';
            payload.groupId = active.groupId;
            payload.groupName = active.label;
        } else {
            payload.toType = 'all';
        }

        var out = store.sendMessage(payload);
        if (!out.ok) {
            window.MediTrackNotify.flash('Not sent', out.error || 'Could not deliver the message.', 'error');
            return;
        }
        if (input) { input.value = ''; input.style.height = 'auto'; }
        pending = [];
        renderPending();
        load(true);
        if (active) openConversation(active);
    }

    /* A dated, human stamp used by the deletion notices:
       "Sunday, Aug 30, 2026 at 8:12 PM". */
    function stampNow() {
        var iso = new Date().toISOString();
        var day = '';
        try { day = new Date().toLocaleDateString('en-US', { weekday: 'long' }) + ', '; } catch (e) {}
        return day + store.formatDate(iso) + ' at ' + store.formatTime(iso);
    }

    /* Notices ride the normal message pipeline with kind='system', so they
       are delivered and stored exactly like any other message but render as
       a plain line in the thread. */
    function postNotice(conv, text) {
        if (!conv || conv.type === 'announce') return;
        var payload = { kind: 'system', body: text, attachments: [] };
        if (conv.type === 'group') {
            payload.toType = 'group';
            payload.groupId = conv.groupId;
            payload.groupName = conv.label;
        } else {
            payload.toType = 'user';
            payload.toUsername = conv.username;
            payload.toName = conv.label;
        }
        store.sendMessage(payload);
    }

    /* ==================================================================
       Chat actions menu
       ================================================================== */
    var chatMenu = null;
    function closeChatMenu() { if (chatMenu) { chatMenu.remove(); chatMenu = null; } }

    function openChatMenu(anchor, items) {
        closeChatMenu();
        var menu = document.createElement('div');
        menu.className = 'msg-ctx-menu';
        menu.innerHTML = items.map(function (it) {
            return '<button type="button" data-act="' + esc(it.act) + '"' + (it.danger ? ' class="danger"' : '') + '>' +
                '<span class="ico" data-icon="' + esc(it.icon) + '" data-icon-size="15"></span>' +
                '<span>' + esc(it.label) + '</span></button>';
        }).join('');
        document.body.appendChild(menu);

        var r = anchor.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(r.right - 200, window.innerWidth - 220)) + 'px';
        menu.style.top = Math.min(r.bottom + 5, window.innerHeight - 160) + 'px';
        chatMenu = menu;

        ui.qsa('button', menu).forEach(function (b) {
            b.addEventListener('click', function () {
                var act = b.getAttribute('data-act');
                closeChatMenu();
                runChatAction(act);
            });
        });
        setTimeout(function () { document.addEventListener('click', closeChatMenu, { once: true }); }, 0);
        if (window.MediIcons) window.MediIcons.hydrate(menu);
    }

    function runChatAction(act) {
        if (act === 'deleteChat') confirmDeleteChat();
        else if (act === 'deleteGroup') confirmDeleteGroup();
        else if (act === 'leaveGroup') confirmLeaveGroup();
    }

    function confirmDeleteChat() {
        var conv = active;
        if (!conv) return;
        ui.confirmAction({
            title: 'Delete this chat?',
            subtitle: conv.label,
            message: 'The conversation leaves your list and the other participants see that you deleted it. ' +
                     'They keep their own copy, and the chat returns if anyone writes again.',
            confirmLabel: 'Delete chat',
            tone: 'danger',
            icon: 'trash'
        }, function () {
            postNotice(conv, me().name + ' deleted the chat on ' + stampNow());
            hideConversation(conv.key);
            clearChatPane();
            load(true);
            window.MediTrackNotify.flash('Chat deleted', conv.label + ' was removed from your list.', 'success');
        });
    }

    function confirmDeleteGroup() {
        var conv = active;
        var g = conv && conv.type === 'group' ? groupOf(conv.groupId) : null;
        if (!g || !canManageGroup(g)) return;
        ui.confirmAction({
            title: 'Delete this group?',
            subtitle: g.name,
            message: 'The group and its conversation are removed for every member. This cannot be undone.',
            confirmLabel: 'Delete group',
            tone: 'danger',
            icon: 'trash'
        }, function () {
            groups = groups.filter(function (x) { return String(x.id) !== String(g.id); });
            store.write(store.KEYS.groups, groups);
            clearChatPane();
            load(true);
            window.MediTrackNotify.flash('Group deleted', g.name + ' was removed for everyone.', 'success');
        });
    }

    function confirmLeaveGroup() {
        var conv = active;
        var g = conv && conv.type === 'group' ? groupOf(conv.groupId) : null;
        if (!g) return;
        postNotice(conv, me().name + ' left the group on ' + stampNow());
        g.members = (g.members || []).filter(function (m) { return lower(m.username) !== lower(me().user); });
        groups = groups.filter(function (x) { return String(x.id) !== String(g.id) || (g.members && g.members.length); });
        store.write(store.KEYS.groups, groups);
        clearChatPane();
        load(true);
        window.MediTrackNotify.flash('Group left', 'You were removed from ' + g.name + '.', 'success');
    }

    /* ==================================================================
       Right-click inside the thread

       One delegated pair of listeners serves the whole thread instead of two
       per attachment, and it replaces the browser's own menu: right-clicking
       a file offers Save/Download, right-clicking a bubble offers
       Copy/Delete.
       ================================================================== */
    var ctxMenu = null;

    function bindThreadEvents() {
        var host = byId('msgThread');
        if (!host) return;
        if (host.__ctxBound) return;      /* listeners survive a re-render */
        host.__ctxBound = true;

        host.addEventListener('contextmenu', function (e) {
            var target = e.target;
            if (!target || !target.closest) return;
            var att = target.closest('[data-msg]');
            if (att) { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, att); return; }
            var row = target.closest('.msg-row[data-mid]');
            if (!row) return;
            e.preventDefault();
            showMsgMenu(e.clientX, e.clientY, row.getAttribute('data-mid'));
        });

        host.addEventListener('click', function (e) {
            var target = e.target;
            if (!target || !target.closest) return;
            if (target.closest('[data-dl]')) return;
            var img = target.closest('.msg-attach-img');
            if (!img) return;
            var lb = byId('imgLightbox');
            var src = byId('imgLightboxSrc');
            if (lb && src) { src.src = img.getAttribute('src'); ui.openModal('imgLightbox'); }
        });
    }

    /* Shared plumbing for both context menus. */
    function placeMenu(menu, x, y) {
        document.body.appendChild(menu);
        var w = menu.offsetWidth || 190;
        var h = menu.offsetHeight || 90;
        menu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
        if (window.MediIcons) window.MediIcons.hydrate(menu);
        /* Dismiss on the next click anywhere, on scroll and on Escape. */
        setTimeout(function () { document.addEventListener('click', closeMenus, { once: true }); }, 0);
        var release = function () { closeMenus(); };
        window.addEventListener('scroll', release, { once: true, capture: true });
        document.addEventListener('keydown', function onKey(e) {
            if (e.key !== 'Escape') return;
            document.removeEventListener('keydown', onKey);
            release();
        });
    }

    function buildMenu(items) {
        var menu = document.createElement('div');
        menu.className = 'msg-ctx-menu';
        menu.innerHTML = items.map(function (it) {
            return '<button type="button" data-act="' + esc(it.act) + '"' +
                (it.danger ? ' class="danger"' : '') + (it.disabled ? ' disabled' : '') + '>' +
                '<span class="ico" data-icon="' + esc(it.icon) + '" data-icon-size="15"></span>' +
                '<span>' + esc(it.label) + '</span></button>';
        }).join('');
        return menu;
    }

    function showMsgMenu(x, y, msgId) {
        closeMenus();
        var m = messages.filter(function (o) { return o.id === msgId; })[0];
        if (!m) return;

        var who = me();
        var mine = lower(m.fromUsername) === lower(who.user);
        var canDelete = mine || isAdmin();
        var items = [];
        if (m.body) items.push({ act: 'copy', label: 'Copy text', icon: 'clipboard' });
        if (canDelete) items.push({ act: 'delete', label: 'Delete message', icon: 'trash', danger: true });
        if (!items.length) {
            items.push({ act: 'noop', label: 'You can only delete your own messages', icon: 'info', disabled: true });
        }

        var menu = buildMenu(items);
        placeMenu(menu, x, y);
        ctxMenu = menu;

        ui.qsa('button', menu).forEach(function (b) {
            b.addEventListener('click', function () {
                var act = b.getAttribute('data-act');
                closeMenus();
                if (act === 'copy') copyText(m.body || '');
                else if (act === 'delete') confirmDeleteMessage(m);
            });
        });
    }

    function copyText(text) {
        if (!text) return;
        var done = function () {
            window.MediTrackNotify.flash('Copied', 'The message text is on your clipboard.', 'success');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, fallbackCopy);
        } else {
            fallbackCopy();
        }
        function fallbackCopy() {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); done(); }
            catch (e) { window.MediTrackNotify.flash('Could not copy', 'Select the text and copy it manually.', 'warning'); }
            ta.remove();
        }
    }

    function confirmDeleteMessage(m) {
        var preview = (m.body || '').replace(/\s+/g, ' ').trim();
        if (preview.length > 90) preview = preview.slice(0, 90) + '…';
        var what = m.attachments && m.attachments.length
            ? (m.attachments.length === 1 ? 'This message and its attached file' : 'This message and its ' + m.attachments.length + ' attachments')
            : 'This message';
        ui.confirmAction({
            title: 'Delete this message?',
            subtitle: preview || 'Attachment only',
            message: what + ' will be removed from the conversation for everyone, not just for you. ' +
                     'Other people will simply see it disappear. This cannot be undone.',
            confirmLabel: 'Delete message', tone: 'danger', icon: 'trash'
        }, function () {
            var out = store.deleteMessage(m.id);
            if (!out.ok) {
                window.MediTrackNotify.flash('Not deleted', out.error || 'The server refused the request.', 'error');
                load(true);
                return;
            }
            messages = messages.filter(function (x) { return x.id !== m.id; });
            load(true);
            window.MediTrackNotify.flash('Message deleted', 'It is gone for everyone in this conversation.', 'success');
        });
    }

    function showCtxMenu(x, y, el) {
        closeCtxMenu();
        var msgId = el.getAttribute('data-msg');
        var idx = Number(el.getAttribute('data-idx'));
        var menu = buildMenu([
            { act: 'inventory', label: 'Save to Inventory', icon: 'archive' },
            { act: 'download', label: 'Download', icon: 'download' }
        ]);
        placeMenu(menu, x, y);
        ctxMenu = menu;

        menu.querySelector('[data-act="inventory"]').addEventListener('click', function () { saveToInventory(msgId, idx); closeCtxMenu(); });
        menu.querySelector('[data-act="download"]').addEventListener('click', function () { downloadAttachment(msgId, idx); closeCtxMenu(); });
    }
    function closeCtxMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }

    /* Both context menus are the same widget; one close covers either. */
    function closeMenus() {
        closeCtxMenu();
        closeChatMenu();
    }

    function findAttachment(msgId, idx) {
        var m = messages.filter(function (x) { return x.id === msgId; })[0];
        if (!m || !m.attachments) return null;
        return m.attachments[idx] || null;
    }

    function saveToInventory(msgId, idx) {
        var a = findAttachment(msgId, idx);
        if (!a) return;
        var who = me();
        var list = store.read(store.KEYS.inventory);
        list.unshift({
            id: 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            kind: a.kind, name: a.name, mime: a.mime, size: a.size, data: a.data,
            source: 'message', savedBy: who.name, note: '', time: new Date().toISOString()
        });
        store.write(store.KEYS.inventory, list);
        window.MediTrackNotify.flash('Saved', a.name + ' was added to your inventory.', 'success');
    }

    function downloadAttachment(msgId, idx) {
        var a = findAttachment(msgId, idx);
        if (!a) return;
        var link = document.createElement('a');
        link.href = a.data; link.download = a.name;
        document.body.appendChild(link); link.click(); link.remove();
    }

    /* ==================================================================
       New group chat
       ================================================================== */
    function openNewChat() {
        var gname = byId('newGroupName'); if (gname) gname.value = '';
        var gdesc = byId('newGroupDesc'); if (gdesc) gdesc.value = '';
        renderGroupMemberList();
        ui.openModal('recipientModal');
    }

    function renderGroupMemberList() {
        var host = byId('newGroupMemberList');
        if (!host) return;
        var who = me();
        var people = staff
            .filter(function (s) { return s.active !== false && lower(s.username) !== lower(who.user); })
            .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
        host.innerHTML = people.length
            ? people.map(function (s) {
                return '<label class="member-row"><input type="checkbox" value="' + esc(s.username) + '" />' +
                    '<span class="avatar avatar-person">' + icon('user', 14) + '</span>' +
                    '<span class="member-name">' + esc(s.name) + '</span>' +
                    '<span class="member-role">' + esc(roleLabel(lower(s.role))) + '</span></label>';
            }).join('')
            : '<p class="empty-state" style="padding:10px">No colleagues to add yet.</p>';
        if (window.MediIcons) window.MediIcons.hydrate(host);
    }

    function startNewChat() {
        var gname = (byId('newGroupName') ? byId('newGroupName').value : '').trim() || 'Group chat';
        var checked = ui.qsa('#newGroupMemberList input:checked');
        var members = Array.prototype.map.call(checked, function (c) { return c.value; });
        if (!members.length) {
            window.MediTrackNotify.flash('Add members', 'Select at least one colleague for the group.', 'warning');
            return;
        }
        var g = createGroup(gname, members);
        ui.closeModal('recipientModal');
        if (g) openConversation({ type: 'group', key: 'g_' + g.id, label: g.name, groupId: g.id, section: 'group' });
    }

    /* ==================================================================
        Load
        ================================================================== */
    var lastSignature = '';

    /* A cheap fingerprint of everything the two panes are drawn from. The
       page polls for other people's messages, and rebuilding the list and
       thread every few seconds was the single biggest cost here — so nothing
       is redrawn unless this actually moves. */
    function signature() {
        var head = messages.length ? (messages[0] && messages[0].id) || '' : '';
        return [messages.length, head, groups.length, staff.length, hidden.length, searchTerm].join('|');
    }

    function load(force) {
        messages = store.read(store.KEYS.messages);
        staff = store.read(store.KEYS.staffMembers);
        loadGroups();
        syncRoleGroups();

        var u = lower(me().user);
        hidden = (store.read(store.KEYS.chatHidden) || []).filter(function (h) {
            return h && lower(h.username) === u;
        });

        var sig = signature();
        if (!force && sig === lastSignature) return;
        lastSignature = sig;

        renderList();
        if (active) { renderHead(); renderThread(); }
    }

    function init() {
        loadSectionPrefs();
        load();

        var search = byId('msgSearch');
        if (search) {
            var runSearch = debounce(function () {
                searchTerm = search.value.trim();
                renderList();
            }, 150);
            search.addEventListener('input', runSearch);
        }

        var newBtn = byId('msgNewChatBtn');
        if (newBtn) newBtn.addEventListener('click', openNewChat);
        var startBtn = byId('newStartBtn');
        if (startBtn) startBtn.addEventListener('click', startNewChat);

        var input = byId('msgInput');
        if (input) {
            input.addEventListener('input', function () {
                var sendBtn = byId('msgSendBtn');
                if (sendBtn) sendBtn.disabled = !canCompose() || (!input.value.trim() && !pending.length);
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            });
        }
        var sendBtn = byId('msgSendBtn');
        if (sendBtn) sendBtn.addEventListener('click', send);

        var attachBtn = byId('msgAttachBtn');
        var fileInput = byId('msgFileInput');
        if (attachBtn && fileInput) {
            attachBtn.addEventListener('click', function () { fileInput.click(); });
            fileInput.addEventListener('change', function () {
                Array.prototype.forEach.call(fileInput.files, function (f) {
                    if (f.size > 4 * 1024 * 1024) {
                        window.MediTrackNotify.flash('File too large', f.name + ' is over 4 MB and was skipped.', 'warning');
                        return;
                    }
                    addPending(f);
                });
                fileInput.value = '';
            });
        }

        var lb = byId('imgLightbox');
        if (lb) lb.addEventListener('click', function () { ui.closeModal('imgLightbox'); });

        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === store.KEYS.messages || e.key === store.KEYS.staffMembers ||
                e.key === store.KEYS.groups || e.key === store.KEYS.chatHidden) load(true);
        });

        /* Fallback for the offline (file://) build, where no cross-tab or
           server events exist at all. Nothing is polled while the tab is in
           the background, and coming back to it refreshes straight away. */
        setInterval(function () { if (!document.hidden) load(); }, 8000);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) load();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window, document);

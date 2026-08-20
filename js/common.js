(function() {
    function updateClock() {
        var now = new Date();
        var h = now.getHours();
        var m = String(now.getMinutes()).padStart(2, '0');
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        var el = document.getElementById('liveTime');
        if (el) el.textContent = h + ':' + m + ' ' + ampm;
    }
    updateClock();
    setInterval(updateClock, 1000);

    var navItems = document.querySelectorAll('.nav-item');
    var menuToggle = document.getElementById('menuToggle');
    var sidebar = document.getElementById('sidebar');
    var contentFrame = document.getElementById('content-frame');
    var pageTitle = document.getElementById('pageTitle');

    if (menuToggle) {
        menuToggle.addEventListener('click', function() {
            sidebar.classList.toggle('open');
        });
    }

    navItems.forEach(function(item) {
        var link = item.querySelector('a');
        if (link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                var targetFile = item.dataset.target;
                var linkText = item.querySelector('span').textContent;
                
                if (targetFile && contentFrame) {
                    contentFrame.src = targetFile;
                    pageTitle.textContent = linkText;
                    
                    navItems.forEach(function(nav) { nav.classList.remove('active'); });
                    item.classList.add('active');
                    
                    if (sidebar.classList.contains('open')) {
                        sidebar.classList.remove('open');
                    }
                }
            });
        }
    });
})();
window.addEventListener('message', function(event) {
    if (event.data && event.data.action === 'toggleBlur') {
        if (event.data.state) {
            document.body.classList.add('blurred-ui');
        } else {
            document.body.classList.remove('blurred-ui');
        }
    }
}, false);
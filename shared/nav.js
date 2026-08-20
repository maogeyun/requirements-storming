(function () {
  var page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.site-links a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href === page || (page === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
})();

(function () {
  'use strict';

  /* ── Accordion ── */
  document.querySelectorAll('.acc-head').forEach(function (head) {
    head.addEventListener('click', function () {
      var acc = head.parentElement;
      var body = acc.querySelector('.acc-body');
      var opening = !acc.classList.contains('open');
      acc.classList.toggle('open');
      if (opening) {
        body.style.maxHeight = body.scrollHeight + 'px';
      } else {
        body.style.maxHeight = '0';
      }
    });
  });

  /* ── Card tabs (scoped to #cards) ── */
  var cardsSection = document.getElementById('cards');
  if (cardsSection) {
    cardsSection.querySelectorAll('.tabs .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        cardsSection.querySelectorAll('.tabs .tab').forEach(function (x) {
          x.classList.remove('active');
        });
        cardsSection.querySelectorAll('.panel').forEach(function (p) {
          p.classList.remove('active');
        });
        tab.classList.add('active');
        var panel = document.getElementById(tab.dataset.tab);
        if (panel) panel.classList.add('active');
      });
    });
  }

  /* ── Hour calculator ── */
  var chips = document.querySelectorAll('#calcChips .chip');
  function recalc() {
    var cap = 40;
    var overtime = false;
    var night = false;
    chips.forEach(function (c) {
      if (c.classList.contains('on')) {
        cap += parseInt(c.dataset.h, 10);
        if (c.dataset.overtime === 'true') overtime = true;
        if (c.dataset.key === 'night') night = true;
      }
    });
    document.getElementById('capOut').textContent = cap + ' 工时';
    var msg = '无加班代价 ✅';
    if (night) msg = '🌙 通宵：-2 绩效 + 2 技术债（含加班代价）';
    else if (overtime) msg = '😩 动用加班：-1 绩效 + 1 技术债';
    var penalty = document.getElementById('penalty');
    penalty.textContent = msg;
    penalty.style.color = night || overtime ? 'var(--red)' : 'var(--green)';
  }
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      c.classList.toggle('on');
      recalc();
    });
  });

  /* ── Progress simulator ── */
  var prog = 0;
  var MS = [40, 100, 160, 200];
  var MS_NAMES = [
    'M1 MVP 雏形 突破者+3',
    'M2 核心功能 突破者+4',
    'M3 体验打磨 突破者+5',
    'M4 正式上线 突破者+8 🚀'
  ];
  var hit = [];
  var sprintEntered = {};

  function nextMilestone(p) {
    for (var i = 0; i < MS.length; i++) {
      if (p < MS[i]) return MS[i];
    }
    return null;
  }

  function inSprintZone(p, next) {
    return p >= next - 15 && p < next;
  }

  function checkSprintZone(before, after) {
    var next = nextMilestone(before);
    if (!next || sprintEntered[next]) return null;
    if (!inSprintZone(before, next) && inSprintZone(after, next)) {
      sprintEntered[next] = true;
      var label = 'M' + (MS.indexOf(next) + 1);
      return '🎯 已进入 ' + label + ' 冲刺区（≤15）—— 开启暗标对赌！';
    }
    return null;
  }

  function renderProg() {
    document.getElementById('fill').style.width = Math.min(prog / 200 * 100, 100) + '%';
    document.getElementById('progVal').textContent = '进度 ' + prog + ' / 200';
  }

  function setSimMsg(msg, isBreakthrough) {
    var el = document.getElementById('simMsg');
    el.textContent = msg;
    el.style.color = isBreakthrough ? 'var(--green)' : 'var(--gold)';
  }

  window.addProg = function (n) {
    var before = prog;
    prog = Math.max(0, Math.min(prog + n, 200));
    var msgs = [];

    var sprintMsg = checkSprintZone(before, prog);
    if (sprintMsg) msgs.push(sprintMsg);

    MS.forEach(function (m, i) {
      if (prog >= m && hit.indexOf(m) === -1) {
        hit.push(m);
        msgs.push('💥 突破 ' + MS_NAMES[i] + '！');
      }
    });

    if (msgs.length) {
      setSimMsg(msgs.join('  '), msgs.some(function (m) { return m.indexOf('突破') !== -1; }));
    }
    renderProg();
  };

  window.resetProg = function () {
    prog = 0;
    hit = [];
    sprintEntered = {};
    setSimMsg(' ', false);
    renderProg();
  };

  renderProg();

  /* ── Dice ── */
  var DICE_PIPS = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };

  var diceFace = document.getElementById('diceFace');
  var diceBtn = document.getElementById('diceBtn');
  var diceResult = document.getElementById('diceResult');
  var diceOut = document.getElementById('diceOut');
  var diceApply = document.getElementById('diceApply');
  var diceRolling = false;
  var hasSim = !!document.getElementById('sim');

  function renderDiceFace(n) {
    if (!diceFace) return;
    if (!n) {
      diceFace.innerHTML = '<span class="dice-unknown">?</span>';
      return;
    }
    var on = DICE_PIPS[n] || [];
    var cells = '';
    for (var i = 0; i < 9; i++) {
      cells += '<div class="dice-pip' + (on.indexOf(i) !== -1 ? ' on' : '') + '"></div>';
    }
    diceFace.innerHTML = '<div class="dice-pips">' + cells + '</div>';
  }

  function setDiceResultState(state) {
    if (!diceResult) return;
    diceResult.classList.remove('is-idle', 'is-good', 'is-bad', 'is-rolling');
    diceResult.classList.add(state);
  }

  if (diceFace) {
    renderDiceFace(0);

    if (diceBtn) {
      diceBtn.addEventListener('click', function () {
        if (diceRolling) return;
        diceRolling = true;
        diceBtn.disabled = true;
        setDiceResultState('is-rolling');
        if (diceOut) diceOut.textContent = '骰子滚动中…';
        if (diceApply) diceApply.hidden = true;

        diceFace.classList.remove('roll');
        void diceFace.offsetWidth;
        diceFace.classList.add('roll');

        var n = 0;
        var c = 0;
        var iv = setInterval(function () {
          n = Math.floor(Math.random() * 6) + 1;
          renderDiceFace(n);
          if (++c > 10) {
            clearInterval(iv);
            var good = n >= 4;
            var delta = good ? 6 : -6;
            setDiceResultState(good ? 'is-good' : 'is-bad');
            if (diceOut) {
              diceOut.textContent = good
                ? '🎉 掷出 ' + n + ' → 进度 +6！'
                : '😬 掷出 ' + n + ' → 进度 -6';
            }
            if (diceApply && hasSim) {
              diceApply.hidden = false;
              diceApply.dataset.delta = String(delta);
              diceApply.textContent = '应用到进度模拟器（' + (delta > 0 ? '+' : '') + delta + '）';
            }
            diceRolling = false;
            diceBtn.disabled = false;
          }
        }, 60);
      });
    }

    if (diceApply && hasSim) {
      diceApply.addEventListener('click', function () {
        var delta = parseInt(diceApply.dataset.delta, 10);
        if (isNaN(delta)) return;
        window.addProg(delta);
        var label = diceApply.textContent;
        diceApply.textContent = '已应用 ✓';
        diceApply.disabled = true;
        setTimeout(function () {
          diceApply.textContent = label;
          diceApply.disabled = false;
        }, 2000);
      });
    } else if (diceApply) {
      diceApply.hidden = true;
    }
  }

  /* ── OKR flip cards ── */
  var okrs = [
    { id: 'O-01', name: '抢镜狂魔', cond: '独揽 2 次里程碑突破（你为突破者）', rw: '+4' },
    { id: 'O-02', name: '救火队长', cond: '全局累计清除 ≥5 个 Bug', rw: '+3' },
    { id: 'O-03', name: '逆风翻盘', cond: '曾某 Sprint / 季垫底，却最终夺 MVP', rw: '+6' },
    { id: 'O-04', name: '零债交付', cond: '结束时名下无技术债且参与 ≥2 次突破', rw: '+4' },
    { id: 'O-05', name: '团队基石', cond: '全局打出 ≥4 张协作卡（不含互动卡）', rw: '+3' },
    { id: 'O-06', name: '效率之王', cond: '全局从未触发加班 / 通宵，且参与 ≥3 次突破', rw: '+5' }
  ];
  var grid = document.getElementById('okrGrid');
  if (grid) {
    okrs.forEach(function (o) {
      var el = document.createElement('div');
      el.className = 'flip';
      el.innerHTML =
        '<div class="flip-inner">' +
        '<div class="flip-face flip-front"><div class="okr-hidden-icon" aria-hidden="true"><span class="okr-hidden-icon__q">?</span></div><div class="note">' + o.id + ' 点击揭晓</div></div>' +
        '<div class="flip-face flip-back"><b>' + o.name + '</b><p class="note">' + o.cond + '</p>' +
        '<div class="reward">奖励 ' + o.rw + ' 绩效</div></div></div>';
      el.addEventListener('click', function () {
        el.classList.toggle('flipped');
      });
      grid.appendChild(el);
    });
  }

  /* ── Page nav: height, hash, scroll spy ── */
  var pageNav = document.querySelector('.page-nav');
  var navLinks = document.querySelectorAll('.page-nav a[href^="#"]');

  function updatePageNavHeight() {
    if (!pageNav) return;
    document.documentElement.style.setProperty('--page-nav-h', pageNav.offsetHeight + 'px');
  }

  updatePageNavHeight();
  window.addEventListener('resize', updatePageNavHeight);

  navLinks.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var id = a.getAttribute('href');
      var target = document.querySelector(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
        history.replaceState(null, '', id);
      }
    });
  });

  if (location.hash) {
    var hashTarget = document.querySelector(location.hash);
    if (hashTarget) {
      requestAnimationFrame(function () {
        hashTarget.scrollIntoView();
      });
    }
  }

  var sections = [];
  navLinks.forEach(function (a) {
    var sec = document.querySelector(a.getAttribute('href'));
    if (sec) sections.push({ id: a.getAttribute('href'), el: sec, link: a });
  });

  if (sections.length && 'IntersectionObserver' in window) {
    var siteNavH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'), 10) || 52;
    var pageNavH = pageNav ? pageNav.offsetHeight : 48;
    var topOffset = siteNavH + pageNavH + 8;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var id = '#' + entry.target.id;
            navLinks.forEach(function (l) {
              l.classList.toggle('active', l.getAttribute('href') === id);
            });
          }
        });
      },
      {
        rootMargin: '-' + topOffset + 'px 0px -55% 0px',
        threshold: 0
      }
    );
    sections.forEach(function (s) {
      observer.observe(s.el);
    });
  }
})();

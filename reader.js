// reader.js — 单篇阅读页逻辑（意中双语 · 段落点读）
(function () {
  'use strict';
  var DATA = window.__GRIMM_INDEX__;
  var PREFS_KEY = 'grimm_prefs_v1';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return (s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ---------- prefs ----------
  var prefs = { mode: 'pair', fs: 19, cont: false, follow: true, loop: false, rate: 1, lang: 'it' };
  try { var p = JSON.parse(localStorage.getItem(PREFS_KEY)); if (p) prefs = Object.assign(prefs, p); } catch (e) {}
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }

  // ---------- routing & per-story data ----------
  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { cb && cb(); };
    s.onerror = function () { cb && cb(new Error('load fail: ' + src)); };
    document.head.appendChild(s);
  }
  function store() {
    return window.__GRIMM_STORIES__ || (window.__GRIMM_STORIES__ = {});
  }
  function getStoryIdx() {
    var id = new URLSearchParams(location.search).get('id');
    var idx = DATA.stories.findIndex(function (s) { return s.id === id; });
    if (idx < 0) idx = 0;
    return idx;
  }
  var storyIdx = getStoryIdx();
  var sid = DATA.stories[storyIdx].id;
  var story = null, paras = null;   // filled by boot() after story data loads

  // ---------- sidebar ----------
  function renderSidebar() {
    var q = ($('sideSearch').value || '').trim().toLowerCase();
    var html = DATA.stories.map(function (s, i) {
      var on = i === storyIdx ? ' on' : '';
      var show = !q ||
        (s.title_it || '').toLowerCase().indexOf(q) >= 0 ||
        (s.title_zh || '').toLowerCase().indexOf(q) >= 0 ||
        s.id.indexOf(q) >= 0;
      if (!show) return '';
      return '<a class="' + on.trim() + '" data-go="' + i + '">' +
        '<span class="cn-no">' + s.id + '</span>' +
        '<span class="cn-it">' + esc(s.title_it) + '</span>' +
        '<span class="cn-zh">' + esc(s.title_zh) + '</span></a>';
    }).join('');
    $('storyNav').innerHTML = html;
    $('sideStats').innerHTML = '共 <b>' + DATA.stories.length + '</b> 篇 · 当前第 ' + (storyIdx + 1) + ' 篇';
  }
  $('storyNav').addEventListener('click', function (e) {
    var a = e.target.closest('[data-go]'); if (!a) return;
    location.href = 'lettura.html?id=' + encodeURIComponent(DATA.stories[+a.dataset.go].id);
  });
  $('sideSearch').addEventListener('input', renderSidebar);

  // ---------- content ----------
  function renderContent() {
    var head =
      '<div class="chapter-head">' +
      '<div class="ch-no">N. ' + story.id + ' / ' + DATA.stories.length + ' · 共 ' + paras.length + ' 句</div>' +
      '<div class="ch-it">' + esc(story.title_it) + '</div>' +
      '<div class="ch-zh">' + esc(story.title_zh) + '</div></div>';
    // 句级单元：一句意大利语 + 对应的一句中文，按原段落(sec)分组保持章节呼吸感
    var body = '';
    var curSec = null;
    paras.forEach(function (p, i) {
      var sec = p.sec || 1;
      if (sec !== curSec) {
        if (curSec !== null) body += '</div>';
        body += '<div class="sect" data-sec="' + sec + '">';
        curSec = sec;
      }
      var zh = p.zh ? '<div class="zh-line">' + esc(p.zh) + '</div>' : '';
      body += '<div class="para" data-idx="' + i + '">' +
        '<div class="para-body">' +
        '<span class="s-no">' + (i + 1) + '</span>' +
        '<div class="it-line">' + esc(p.it) + '</div>' + zh + '</div></div>';
    });
    if (curSec !== null) body += '</div>';
    $('content').innerHTML = head + body;
    $('chapterFootLabel').textContent = '第 ' + (storyIdx + 1) + ' / ' + DATA.stories.length + ' 篇';
  }

  // ---------- mode / font / switches ----------
  function applyMode() {
    document.body.className = 'mode-' + prefs.mode;
    Array.prototype.forEach.call(document.querySelectorAll('#modeSeg button'), function (b) {
      b.classList.toggle('on', b.dataset.mode === prefs.mode);
    });
  }
  function applyFont() {
    document.documentElement.style.setProperty('--fs', prefs.fs + 'px');
  }
  $('modeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    prefs.mode = b.dataset.mode; applyMode(); savePrefs();
  });
  $('btnFontUp').addEventListener('click', function () { prefs.fs = Math.min(28, prefs.fs + 1); applyFont(); savePrefs(); });
  $('btnFontDn').addEventListener('click', function () { prefs.fs = Math.max(15, prefs.fs - 1); applyFont(); savePrefs(); });
  $('chkCont').checked = prefs.cont;
  $('chkFollow').checked = prefs.follow;
  $('chkLoop').checked = prefs.loop;
  $('rate').value = prefs.rate; $('rateVal').textContent = (+prefs.rate).toFixed(2) + '×';
  $('chkCont').addEventListener('change', function () { prefs.cont = this.checked; savePrefs(); });
  $('chkFollow').addEventListener('change', function () { prefs.follow = this.checked; savePrefs(); });
  $('chkLoop').addEventListener('change', function () { prefs.loop = this.checked; savePrefs(); audio.loop = false; });

  // ---------- 朗读语言：意语 / 中文 / 意中交替 ----------
  var LANG_LABELS = { it: '意大利语', zh: '中文', alt: '意语 + 中文 交替' };
  function applyLang() {
    Array.prototype.forEach.call(document.querySelectorAll('#langSeg button'), function (b) {
      b.classList.toggle('on', b.dataset.lang === prefs.lang);
    });
  }
  applyLang();
  $('langSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    prefs.lang = b.dataset.lang; applyLang(); savePrefs();
    $('nowSub').textContent = '朗读语言：' + (LANG_LABELS[prefs.lang] || '') + ' · 单击句子朗读';
    // 若正在播放，立即按新语言重播当前句
    if (cur >= 0 && playing) { setCur(cur, { play: true }); }
  });

  // ---------- player ----------
  var audio = $('audio');
  var cur = -1;          // 当前段落
  var playing = false;
  var playAll = false;    // 播放全篇模式：从第一句连续播到结尾
  var altZhDone = false; // 意中交替模式下，当前句中文部分是否已播
  var loadingNext = false; // 自动连播换源时的过渡暂停，不触发菜单显示
  var manualPause = false; // 用户手动暂停（应当显示菜单）
  // 判断是否处于“连续自动播放链”中（意→中 交替、跨段落连播）：
  // 链中换源产生的过渡暂停/自然结束不应闪出菜单，须等整条链播完才显示
  function isChaining() {
    if (playAll && cur < paras.length - 1) return true;
    if (prefs.cont && cur < paras.length - 1) return true;
    if (prefs.lang === 'alt' && !altZhDone && cur >= 0 && paras[cur] &&
        paras[cur].audio_zh && paras[cur].audio_zh.length) return true;
    return false;
  }

  // 自动滚动：播放时画面跳到当前句子起始位置（block:'start'），便于跟读
  function scrollToPara(i) {
    if (!prefs.follow) return;
    var el = document.querySelector('.para[data-idx="' + i + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setAudioSrc(p) {
    if (prefs.lang === 'zh') {
      audio.src = (p.audio_zh && p.audio_zh.length) ? p.audio_zh : p.audio;
      altZhDone = true;
    } else {
      audio.src = p.audio;
      altZhDone = false;
    }
  }
  function setCur(i, opts) {
    opts = opts || {};
    if (!paras || i < 0 || i >= paras.length) return;
    cur = i;
    var p = paras[i];
    Array.prototype.forEach.call(document.querySelectorAll('.para'), function (el) {
      el.classList.toggle('playing', +el.dataset.idx === i);
    });
    $('readProgress').textContent = '第 ' + (i + 1) + ' 句 / ' + paras.length;
    $('nowTitle').textContent = '第 ' + (i + 1) + ' 句 · ' + story.title_it;
    scrollToPara(i);
    audio.loop = false;
    altZhDone = false;
    loadingNext = true;            // 换源过程中的过渡暂停不展示菜单
    setAudioSrc(p);
    try { audio.load(); } catch (e) {}
    if (opts.play) {
      play();
      setTimeout(function () { loadingNext = false; }, 600); // 兜底：play 事件未触发时复位
    } else {
      loadingNext = false;
    }
  }
  function play() {
    if (cur < 0) { setCur(0, { play: false }); }
    audio.play().then(function () { playing = true; $('btnPlay').textContent = '❚❚'; })
      .catch(function () { playing = false; $('btnPlay').textContent = '▶'; });
  }
  function pause() { manualPause = true; audio.pause(); playing = false; $('btnPlay').textContent = '▶'; }
  function toggle() { if (playing) pause(); else play(); }

  function markNoAudio(i) {
    var el = document.querySelector('.para[data-idx="' + i + '"]');
    if (el) el.classList.add('noaudio');
  }

  $('btnPlay').addEventListener('click', toggle);
  $('btnPlayAll').addEventListener('click', function () { playAll = true; $('btnPlayAll').classList.add('active'); setBars(false); setCur(0, { play: true }); });
  $('btnPrevPara').addEventListener('click', function () { if (cur > 0) { playAll = false; $('btnPlayAll').classList.remove('active'); setCur(cur - 1, { play: playing }); } });
  $('btnNextPara').addEventListener('click', function () { if (cur < paras.length - 1) { playAll = false; $('btnPlayAll').classList.remove('active'); setCur(cur + 1, { play: playing }); } });
  $('btnRepeat').addEventListener('click', function () { if (cur >= 0) { audio.currentTime = 0; play(); } });

  $('content').addEventListener('click', function (e) {
    var playBtn = e.target.closest('[data-play]');
    var para = e.target.closest('.para');
    if (!para) return;
    var i = +para.dataset.idx;
    // 手动点选某句：退出“播放全篇”连播模式（仅播该句）
    playAll = false; $('btnPlayAll').classList.remove('active');
    if (playBtn) {
      setCur(i, { play: true }); return;
    }
    // 单击段落正文：朗读该段；Shift+单击：从此段开始连续播放
    prefs.cont = e.shiftKey ? true : prefs.cont;
    setCur(i, { play: true });
  });

  audio.addEventListener('play', function () {
    loadingNext = false;          // 真正恢复播放后解除换源守卫
    playing = true; $('btnPlay').textContent = '❚❚';
    // 段落切换重启播放时：仅当菜单是"播放自动隐藏"状态才重新倒计时；
    // 用户正按住菜单或刚唤出菜单时不得打扰
    if (!holdActive && !userRevealed && !document.body.classList.contains('immersive')) {
      if (isChaining()) setBars(false);   // 连播中：立即隐藏菜单，不延迟
      else barsHideSoon(1600);
    }
  });
  audio.addEventListener('pause', function () {
    playing = false; $('btnPlay').textContent = '▶';
    if (manualPause) { manualPause = false; barsShow(); }   // 用户手动暂停 → 显示菜单
    else if (!loadingNext && !isChaining()) barsShow();     // 自动换源/连播中的过渡暂停不展示菜单
  });
  audio.addEventListener('error', function () { if (cur >= 0) markNoAudio(cur); });
  audio.addEventListener('ended', function () {
    if (prefs.loop && cur >= 0) { audio.currentTime = 0; play(); return; }
    // 意中交替：本句意语播完 → 接着播中文，再进下一句
    if (prefs.lang === 'alt' && !altZhDone && cur >= 0) {
      var p = paras[cur];
      if (p.audio_zh && p.audio_zh.length) {
        loadingNext = true;       // 意→中 换源过渡暂停不展示菜单
        audio.src = p.audio_zh; audio.load(); play(); altZhDone = true; return;
      }
      altZhDone = true; // 无中文音频则跳过中文部分
    }
    if ((prefs.cont || playAll) && cur < paras.length - 1) { setCur(cur + 1, { play: true }); }
    else { playing = false; playAll = false; $('btnPlay').textContent = '▶'; $('btnPlayAll').classList.remove('active'); barsShow(); }
  });
  audio.addEventListener('timeupdate', function () {
    if (!audio.duration) return;
    $('seek').value = Math.round((audio.currentTime / audio.duration) * 1000);
    $('tCur').textContent = fmt(audio.currentTime);
    $('tDur').textContent = fmt(audio.duration);
  });
  $('seek').addEventListener('input', function () {
    if (audio.duration) audio.currentTime = (this.value / 1000) * audio.duration;
  });
  $('rate').addEventListener('input', function () {
    prefs.rate = +this.value; audio.playbackRate = prefs.rate; $('rateVal').textContent = prefs.rate.toFixed(2) + '×'; savePrefs();
  });
  $('btnRateReset').addEventListener('click', function () {
    prefs.rate = 1; audio.playbackRate = 1; $('rate').value = 1; $('rateVal').textContent = '1.00×'; savePrefs();
  });

  // ---------- 沉浸模式：播放时隐藏上/下栏并折叠占位（阅读区变大），点击阅读区显示 ----------
  // holdActive: 指针/手指停在菜单上；userRevealed: 用户刚点出菜单（倒计时窗口内）
  // 两者存在时，段落切换的 play 事件不得重启自动隐藏
  var immerseTimer = null;
  var holdActive = false;
  var userRevealed = false;
  // 菜单自动隐藏（沉浸模式）仅限手机/窄屏；桌面端始终显示菜单栏
  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width:900px)').matches;
  }
  function setBars(visible) {
    var tb = document.getElementById('toolbar'), pl = document.getElementById('player');
    if (!tb || !pl) return;
    if (visible) {
      tb.style.marginTop = '';
      pl.style.marginBottom = '';
      document.body.classList.remove('immersive');
    } else {
      if (!isMobile()) return;  // 桌面端不隐藏菜单栏
      // 负 margin 折掉两栏占位，#reader 随之撑满
      tb.style.marginTop = -tb.offsetHeight + 'px';
      pl.style.marginBottom = -pl.offsetHeight + 'px';
      document.body.classList.add('immersive');
    }
  }
  function barsShow() {
    if (immerseTimer) { clearTimeout(immerseTimer); immerseTimer = null; }
    userRevealed = false;
    setBars(true);
  }
  function holdBars() {
    holdActive = true;
    if (immerseTimer) { clearTimeout(immerseTimer); immerseTimer = null; }
  }
  function barsHideSoon(ms) {
    if (!isMobile()) return;  // 桌面端不启动自动隐藏计时
    if (immerseTimer) clearTimeout(immerseTimer);
    immerseTimer = setTimeout(function () {
      immerseTimer = null;
      userRevealed = false;
      if (playing) setBars(false);
    }, ms || 1600);
  }
  $('reader').addEventListener('click', function () {
    if (document.body.classList.contains('immersive')) {
      if (immerseTimer) { clearTimeout(immerseTimer); immerseTimer = null; }
      userRevealed = true;
      setBars(true);
      if (playing) barsHideSoon(7500);   // 仍在播放则 7.5s 后再次隐藏
    }
  });
  // 手指/鼠标停在菜单上或正在操作时：菜单保持显示，离开后才开始倒计时
  ['toolbar', 'player'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerenter', holdBars);          // 悬停/按住 → 暂停倒计时
    el.addEventListener('pointerdown', holdBars);           // 触摸按住兜底
    el.addEventListener('pointerleave', function () {       // 离开/抬手 → 恢复倒计时
      holdActive = false;
      if (playing && !document.body.classList.contains('immersive')) barsHideSoon(7500);
    });
  });

  // ---------- prev / next story ----------
  function goStory(d) {
    var ni = storyIdx + d;
    if (ni < 0 || ni >= DATA.stories.length) return;
    location.href = 'lettura.html?id=' + encodeURIComponent(DATA.stories[ni].id);
  }
  $('btnPrev').addEventListener('click', function () { goStory(-1); });
  $('btnNext').addEventListener('click', function () { goStory(1); });

  // ---------- misc UI ----------
  $('btnMenu').addEventListener('click', function () {
    $('sidebar').classList.toggle('hidden'); $('overlay').classList.toggle('on');
  });
  $('overlay').addEventListener('click', function () {
    $('sidebar').classList.add('hidden'); $('overlay').classList.remove('on');
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.code === 'ArrowLeft') { if (cur > 0) setCur(cur - 1, { play: playing }); }
    else if (e.code === 'ArrowRight') { if (cur < paras.length - 1) setCur(cur + 1, { play: playing }); }
    else if (e.key === 'r' || e.key === 'R') { if (cur >= 0) { audio.currentTime = 0; play(); } }
  });

  // ---------- init ----------
  // 手机/窄屏：侧边栏默认收起，点 ☰ 展开
  if (window.matchMedia && window.matchMedia('(max-width:900px)').matches) {
    $('sidebar').classList.add('hidden');
  }
  // 桌面端始终显示菜单栏：跨断点切到宽屏时，强制复位任何残留的沉浸态
  window.addEventListener('resize', function () {
    if (!isMobile() && document.body.classList.contains('immersive')) barsShow();
  });
  renderSidebar();

  function boot() {
    story = store()[sid];
    paras = story.paras;
    playAll = false;
    var paBtn = document.getElementById('btnPlayAll'); if (paBtn) paBtn.classList.remove('active');
    renderContent();
    applyMode();
    applyFont();
    audio.playbackRate = prefs.rate;
    // 空闲时预取上/下一篇，切换几乎零等待
    setTimeout(function () {
      [storyIdx - 1, storyIdx + 1].forEach(function (j) {
        var n = DATA.stories[j];
        if (n && !store()[n.id]) loadScript('data/st/' + n.id + '.js');
      });
    }, 1200);
  }

  if (store()[sid]) {
    boot();
  } else {
    loadScript('data/st/' + sid + '.js', function (err) {
      if (err) {
        $('content').innerHTML = '<p style="color:#8a1f2b;padding:30px 0">加载失败，请刷新重试。</p>';
        return;
      }
      boot();
    });
  }
})();

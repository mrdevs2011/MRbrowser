#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MR Browser - classic UI on a lightweight native WebKitGTK engine (no Electron / Chromium)."""
import os, sys, json, time, base64, re, copy, signal, threading, traceback
import urllib.request, urllib.parse
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
try:
    gi.require_version('WebKit2', '4.1')
except ValueError:
    gi.require_version('WebKit2', '4.0')
from gi.repository import Gtk, Gdk, GLib, Gio, GdkPixbuf, WebKit2

BASE = os.path.dirname(os.path.abspath(__file__))
UI_HTML = os.path.join(BASE, 'src', 'renderer', 'chrome', 'ui.html')
BRIDGE_JS = os.path.join(BASE, 'src', 'renderer', 'chrome', 'webkit_bridge.js')
I18N_JSON = os.path.join(BASE, 'assets', 'i18n.json')
SHIELDS_JSON = os.path.join(BASE, 'assets', 'shields.json')
DATA_DIR = os.path.join(os.path.expanduser('~'), '.config', 'mrbrowser', 'webkit-classic')
os.makedirs(DATA_DIR, exist_ok=True)
STORE_FILE = os.path.join(DATA_DIR, 'store.json')

VERSION = '2.1.0 (WebKit)'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
ENGINES = {
    'google': {'name': 'Google', 'url': 'https://www.google.com/search?q=%s', 'home': 'https://www.google.com/',
               'sug': 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s'},
    'duckduckgo': {'name': 'DuckDuckGo', 'url': 'https://duckduckgo.com/?q=%s', 'home': 'https://duckduckgo.com/',
                   'sug': 'https://duckduckgo.com/ac/?q=%s&type=list'},
}
ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0]
CHROME_H, BAR_H, FIND_H = 66, 28, 36
BLANK_HTML = ('<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0;background:#0b0e14;'
              'color:#9fd8ff;font:600 22px system-ui,sans-serif;display:flex;align-items:center;'
              'justify-content:center}span{opacity:.45;letter-spacing:.5px}</style><body><span>MR Browser</span>')


def host_of(url):
    try:
        return urllib.parse.urlsplit(url or '').hostname or ''
    except Exception:
        return ''


def strip_url(u):
    return re.sub(r'^https?://(www\.)?', '', u or '').rstrip('/')


def display(u):
    if not u or u.startswith('about:'):
        return ''
    if u.startswith('https://'):
        u = u[8:]
    if u.endswith('/') and u.count('/') == 1:
        u = u[:-1]
    return u


def sec_level(u):
    if u.startswith('https://'):
        return 'secure'
    if u.startswith('http://'):
        return 'insecure'
    return 'internal'


def resolve_input(text, engine):
    t = (text or '').strip()
    if not t:
        return None
    if re.match(r'^(https?|file|about|view-source):', t, re.I):
        return ('url', t)
    if ' ' not in t and re.match(r'^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#].*)?$', t, re.I):
        return ('url', 'http://' + t)
    if ' ' not in t and re.match(r'^[^\s/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$', t, re.I):
        return ('url', 'https://' + t)
    e = ENGINES.get(engine) or ENGINES['google']
    return ('search', e['url'].replace('%s', urllib.parse.quote_plus(t)))


class Store:
    BASE = {
        'settings': {'shields': True, 'bookmarksBar': True, 'language': 'uz', 'theme': 'dark', 'engine': 'google'},
        'history': [], 'bookmarks': [], 'shieldsOff': [], 'totalBlocked': 0, 'nextBm': 1,
    }

    def __init__(self):
        self.d = {}
        try:
            with open(STORE_FILE, 'r', encoding='utf-8') as f:
                self.d = json.load(f)
        except Exception:
            self.d = {}
        for k, v in self.BASE.items():
            if k not in self.d:
                self.d[k] = copy.deepcopy(v)
        for k, v in self.BASE['settings'].items():
            self.d['settings'].setdefault(k, v)
        self._src = 0

    def save(self):
        if self._src:
            return

        def w():
            self._src = 0
            self.flush()
            return False
        self._src = GLib.timeout_add(400, w)

    def flush(self):
        try:
            tmp = STORE_FILE + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self.d, f, ensure_ascii=False)
            os.replace(tmp, STORE_FILE)
        except Exception as e:
            print('[store]', e, file=sys.stderr)


class Tab:
    def __init__(self, app, tid, related=None):
        self.app = app
        self.id = tid
        self.title = ''
        self.favicon = ''
        self.loading = False
        self.pinned = False
        self.audible = False
        self.muted = False
        self.blocked = 0
        self.home_blank = related is None
        self.zoom = 1.0
        self.find_text = ''
        self.find_idx = 0
        self.find_n = 0
        if related is not None:
            self.view = WebKit2.WebView(related_view=related.view)
        else:
            self.view = WebKit2.WebView(web_context=app.ctx, user_content_manager=app.tab_ucm)
        s = self.view.get_settings()
        for fn, val in (('set_enable_developer_extras', True), ('set_enable_smooth_scrolling', True),
                        ('set_enable_accelerated_2d_canvas', True),
                        ('set_enable_media_stream', True), ('set_enable_mediasource', True),
                        ('set_enable_webgl', True), ('set_enable_page_cache', True),
                        ('set_enable_site_specific_quirks', True),
                        ('set_enable_back_forward_navigation_gestures', True),
                        ('set_javascript_can_open_windows_automatically', True),
                        ('set_user_agent', UA)):
            try:
                getattr(s, fn)(val)
            except Exception:
                pass
        try:
            s.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)
        except Exception:
            pass
        v = self.view
        v.connect('notify::title', self.on_title)
        v.connect('notify::uri', self.on_uri)
        v.connect('load-changed', self.on_load)
        v.connect('notify::favicon', self.on_favicon)
        v.connect('notify::is-playing-audio', self.on_audio)
        v.connect('create', self.on_create)
        v.connect('permission-request', self.on_perm)
        v.connect('enter-fullscreen', self.on_enter_fs)
        v.connect('leave-fullscreen', self.on_leave_fs)
        v.connect('web-process-terminated', self.on_crash)
        v.connect('key-press-event', app.on_key)
        v.connect('button-press-event', self.on_click)
        v.connect('scroll-event', self.on_scroll)
        fc = v.get_find_controller()
        fc.connect('found-text', self.on_found)
        fc.connect('failed-to-find-text', self.on_not_found)

    def on_scroll(self, v, ev):
        state = ev.state
        ctrl = bool(state & Gdk.ModifierType.CONTROL_MASK)
        shift = bool(state & Gdk.ModifierType.SHIFT_MASK)
        alt = bool(state & Gdk.ModifierType.MOD1_MASK)

        # Shift + Wheel or horizontal scroll gesture switches tabs/scrolls horizontally like Niri
        if shift or alt:
            if ev.direction == Gdk.ScrollDirection.UP or ev.direction == Gdk.ScrollDirection.LEFT:
                self.app.cycle_tabs(-1)
                return True
            elif ev.direction == Gdk.ScrollDirection.DOWN or ev.direction == Gdk.ScrollDirection.RIGHT:
                self.app.cycle_tabs(1)
                return True
            elif ev.direction == Gdk.ScrollDirection.SMOOTH:
                ok, dx, dy = ev.get_scroll_deltas()
                if ok and abs(dx) > 0.4:
                    self.app.cycle_tabs(1 if dx > 0 else -1)
                    return True
                elif ok and shift and abs(dy) > 0.4:
                    self.app.cycle_tabs(1 if dy > 0 else -1)
                    return True

        if ev.direction == Gdk.ScrollDirection.SMOOTH:
            ok, dx, dy = ev.get_scroll_deltas()
            if ok and abs(dx) > 1.2:
                # 2-finger horizontal swipe between tabs
                self.app.cycle_tabs(1 if dx > 0 else -1)
                return True
        elif ev.direction == Gdk.ScrollDirection.LEFT:
            self.app.cycle_tabs(-1)
            return True
        elif ev.direction == Gdk.ScrollDirection.RIGHT:
            self.app.cycle_tabs(1)
            return True

        return False

    def show_blank(self):
        self.view.load_html(BLANK_HTML, 'about:blank')

    def on_title(self, v, _p):
        self.title = v.get_title() or ''
        self.app.schedule_push()

    def on_uri(self, v, _p):
        u = v.get_uri() or ''
        if u and not u.startswith('about:') and self.home_blank:
            self.home_blank = False
        self.app.schedule_push()

    def on_load(self, v, ev):
        if ev == WebKit2.LoadEvent.STARTED:
            self.loading = True
        elif ev == WebKit2.LoadEvent.FINISHED:
            self.loading = False
            self.app.add_history(self)
        self.app.schedule_push()

    def on_favicon(self, v, _p):
        try:
            surf = v.get_favicon()
            if surf is None:
                self.favicon = ''
            else:
                w, h = surf.get_width(), surf.get_height()
                pb = Gdk.pixbuf_get_from_surface(surf, 0, 0, w, h)
                if pb is not None:
                    if w > 32:
                        pb = pb.scale_simple(32, 32, GdkPixbuf.InterpType.BILINEAR)
                    ok, data = pb.save_to_bufferv('png', [], [])
                    if ok:
                        self.favicon = 'data:image/png;base64,' + base64.b64encode(data).decode()
        except Exception:
            self.favicon = ''
        self.app.schedule_push()

    def on_audio(self, v, _p):
        self.audible = bool(v.get_property('is-playing-audio'))
        self.app.schedule_push()

    def on_create(self, v, nav):
        nt = self.app.new_tab(related=self, after=self)
        return nt.view

    def on_perm(self, v, req):
        return self.app.add_permission(self, req)

    def on_enter_fs(self, v):
        self.app.set_html_fs(True)
        return False

    def on_leave_fs(self, v):
        self.app.set_html_fs(False)
        return False

    def on_crash(self, v, reason):
        GLib.idle_add(v.reload)

    def on_click(self, v, ev):
        self.app.send_ui('page-focused')
        return False

    def on_found(self, fc, n):
        self.find_n = n
        if self.find_idx < 1:
            self.find_idx = 1
        if self is self.app.active:
            self.app.send_ui('find-result', {'active': self.find_idx, 'matches': n})

    def on_not_found(self, fc):
        self.find_n = 0
        if self is self.app.active:
            self.app.send_ui('find-result', {'active': 0, 'matches': 0})


class App(Gtk.Window):
    def __init__(self):
        super().__init__(title='MR Browser')
        self.set_default_size(1360, 840)
        try:
            self.set_icon_from_file(os.path.join(BASE, 'assets', 'icon.png'))
        except Exception:
            pass
        self.store = Store()
        try:
            with open(I18N_JSON, 'r', encoding='utf-8') as f:
                self.i18n = json.load(f)
        except Exception:
            self.i18n = {}
        self.tabs = []
        self.active = None
        self.next_id = 1
        self.closed = []
        self.overlay_open = False
        self.find_open = False
        self.html_fs = False
        self.tile = False
        self.tile_ratio = 0.5
        self.perms = {}
        self.perm_seq = 0
        self.dls = []
        self.dl_seq = 0
        self.ctx_actions = {}
        self.push_src = 0
        self.ui_ready = False
        self.last_dl_push = 0

        self._init_styles()

        dm = WebKit2.WebsiteDataManager(
            base_data_directory=os.path.join(DATA_DIR, 'web_data'),
            base_cache_directory=os.path.join(DATA_DIR, 'web_cache'))
        try:
            dm.get_cookie_manager().set_persistent_storage(
                os.path.join(DATA_DIR, 'cookies.sqlite'), WebKit2.CookiePersistentStorage.SQLITE)
        except Exception as e:
            print('[cookies]', e, file=sys.stderr)
        self.ctx = WebKit2.WebContext.new_with_website_data_manager(dm)
        try:
            self.ctx.set_cache_model(WebKit2.CacheModel.WEB_BROWSER)
            self.ctx.set_process_model(WebKit2.ProcessModel.MULTIPLE_SECONDARY_PROCESSES)
            self.ctx.set_web_process_count_limit(8)
        except Exception:
            pass
        self.ctx.connect('download-started', self.on_download)
        self.tab_ucm = WebKit2.UserContentManager()

        self.on_map = {
            'new-tab': lambda *a: self.new_tab(),
            'close-tab': self.close_tab, 'switch-tab': self.switch_tab, 'move-tab': self.move_tab,
            'mute-tab': self.mute_tab, 'navigate': self.navigate, 'open-url': self.open_url,
            'back': lambda *a: self.nav_do('back'), 'forward': lambda *a: self.nav_do('forward'),
            'reload': self.reload, 'stop': lambda *a: self.nav_do('stop'),
            'focus-page': lambda *a: self.focus_page(), 'overlay': self.set_overlay, 'cmd': self.run_cmd,
            'find': self.on_find, 'find-close': self.find_close, 'find-visible': self.find_visible,
            'dl-action': self.dl_action, 'perm-answer': self.perm_answer, 'shield-toggle': self.shield_toggle,
            'tab-menu': self.tab_menu, 'bm-menu': self.bm_menu, 'ctx-pick': self.ctx_pick,
        }
        self.inv_map = {
            'suggest': self.inv_suggest, 'autocomplete': self.inv_autocomplete,
            'suggest-web': self.inv_suggest_web, 'downloads': lambda reply, *a: reply(self.dl_list()),
            'account-info': lambda reply, *a: reply({'id': 'default', 'name': 'MR', 'color': '#9fd8ff', 'isDefault': True}),
            'accounts:list': lambda reply, *a: reply({'accounts': [], 'current': 'default'}),
        }

        self.build()
        self.apply_shields()
        self.connect('delete-event', self.on_delete)
        self.connect('key-press-event', self.on_key)
        self.connect('window-state-event', lambda *a: self.schedule_push())
        self.new_tab()

    def _init_styles(self):
        css_data = b'''
        paned > separator {
            background-color: rgba(255, 255, 255, 0.1);
            min-width: 6px;
            margin: 0;
            transition: background-color 0.15s ease, min-width 0.15s ease;
        }
        paned > separator:hover {
            background-color: #3b82f6;
            min-width: 8px;
        }
        '''
        try:
            provider = Gtk.CssProvider()
            provider.load_from_data(css_data)
            Gtk.StyleContext.add_provider_for_screen(
                Gdk.Screen.get_default(),
                provider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            )
        except Exception as e:
            print('[css]', e, file=sys.stderr)

    # ---------- UI shell ----------
    def build(self):
        self.ovl = Gtk.Overlay()
        self.add(self.ovl)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.spacer = Gtk.Box()
        box.pack_start(self.spacer, False, False, 0)
        self.paned = Gtk.Paned(orientation=Gtk.Orientation.HORIZONTAL)
        self.nb = Gtk.Notebook()
        self.nb.set_show_tabs(False)
        self.nb.set_show_border(False)
        self.extra_nb = Gtk.Notebook()
        self.extra_nb.set_show_tabs(False)
        self.extra_nb.set_show_border(False)
        self.paned.pack1(self.nb, resize=True, shrink=False)
        self.paned.pack2(self.extra_nb, resize=True, shrink=False)
        self.extra_nb.hide()
        self.paned.connect('button-release-event', self._on_paned_release)
        box.pack_start(self.paned, True, True, 0)
        self.ovl.add(box)

        ucm = WebKit2.UserContentManager()
        ucm.register_script_message_handler('mrb')
        ucm.connect('script-message-received::mrb', self.on_ui_message)
        try:
            with open(BRIDGE_JS, 'r', encoding='utf-8') as f:
                js = f.read()
            ucm.add_script(WebKit2.UserScript(js, WebKit2.UserContentInjectedFrames.TOP_FRAME,
                                              WebKit2.UserScriptInjectionTime.START, None, None))
        except Exception as e:
            print('[bridge]', e, file=sys.stderr)
        self.ui = WebKit2.WebView(web_context=WebKit2.WebContext.new_ephemeral(), user_content_manager=ucm)
        st = self.ui.get_settings()
        if os.environ.get('MRB_DEBUG'):
            st.set_enable_write_console_messages_to_stdout(True)
        for fn, val in (('set_allow_file_access_from_file_urls', True),
                        ('set_allow_universal_access_from_file_urls', True),
                        ('set_enable_developer_extras', True)):
            try:
                getattr(st, fn)(val)
            except Exception:
                pass
        rgba = Gdk.RGBA()
        rgba.parse('rgba(0,0,0,0)')
        self.ui.set_background_color(rgba)
        self.ui.set_halign(Gtk.Align.FILL)
        self.ui.set_valign(Gtk.Align.START)
        self.ui.connect('context-menu', lambda *a: True)
        self.ui.connect('load-changed', self.on_ui_load)
        self.ui.connect('key-press-event', self.on_key)
        self.ovl.add_overlay(self.ui)
        self.ovl.set_overlay_pass_through(self.ui, False)
        self.ovl.connect('get-child-position', self.on_overlay_child_pos)
        self.relayout()
        self.ui.load_uri('file://' + UI_HTML)

    def on_overlay_child_pos(self, ovl, widget, alloc):
        if widget is self.ui:
            alloc.x = 0
            alloc.y = 0
            alloc.width = ovl.get_allocated_width()
            alloc.height = ovl.get_allocated_height() if self.overlay_open else self.chrome_h()
            return True
        return False

    def on_ui_load(self, v, ev):
        if ev == WebKit2.LoadEvent.FINISHED:
            self.ui_ready = True
            self.schedule_push()

    def chrome_h(self):
        if self.html_fs:
            return 0
        return CHROME_H + (BAR_H if self.store.d['settings']['bookmarksBar'] else 0) + (FIND_H if self.find_open else 0)

    def relayout(self):
        h = self.chrome_h()
        self.spacer.set_size_request(-1, h)
        if self.overlay_open:
            self.ui.set_valign(Gtk.Align.FILL)
            self.ui.set_size_request(-1, -1)
        else:
            self.ui.set_valign(Gtk.Align.START)
            self.ui.set_size_request(-1, h)
        self.ui.set_visible(h > 0 or self.overlay_open)
        self.ui.queue_resize()
        self.ovl.queue_resize()

    def eval_ui(self, js):
        try:
            if hasattr(self.ui, 'evaluate_javascript'):
                self.ui.evaluate_javascript(js, -1, None, None, None, None)
            else:
                self.ui.run_javascript(js, None, None, None)
        except Exception as e:
            print('[eval_ui]', e, file=sys.stderr)

    def send_ui(self, channel, *args):
        if not self.ui_ready:
            return
        parts = ','.join(json.dumps(x) for x in (channel,) + args)
        self.eval_ui('window.__mrbDispatch&&window.__mrbDispatch(%s);' % parts)

    def on_ui_message(self, mgr, res):
        try:
            v = res.get_js_value() if hasattr(res, 'get_js_value') else res
            msg = json.loads(v.to_json(0))
        except Exception as e:
            print('[ui msg]', e, file=sys.stderr)
            return
        ch = msg.get('channel')
        args = msg.get('args') or []
        try:
            if msg.get('type') == 'invoke':
                mid = msg.get('id')
                fn = self.inv_map.get(ch)

                def reply(result, mid=mid):
                    self.eval_ui('window.__mrbReply&&window.__mrbReply(%d,%s,null);' % (mid, json.dumps(result)))
                if fn:
                    fn(reply, *args)
                else:
                    reply(None)
            else:
                fn = self.on_map.get(ch)
                if fn:
                    fn(*args)
        except Exception:
            traceback.print_exc()

    # ---------- state ----------
    def T(self, key):
        s = self.store.d['settings']
        d = self.i18n.get(s.get('language', 'uz')) or self.i18n.get('uz') or {}
        return d.get(key, key)

    def schedule_push(self):
        if self.push_src or not self.ui_ready:
            return

        def go():
            self.push_src = 0
            self.send_ui('state', self.build_state())
            return False
        self.push_src = GLib.timeout_add(30, go)

    def theme(self):
        p = self.store.d['settings'].get('theme', 'dark')
        if p in ('dark', 'light'):
            return p
        try:
            return 'dark' if Gtk.Settings.get_default().get_property('gtk-application-prefer-dark-theme') else 'light'
        except Exception:
            return 'dark'

    def build_state(self):
        t = self.active
        v = t.view if t else None
        raw = (v.get_uri() or '') if v else ''
        blank = t is None or t.home_blank or not raw or raw.startswith('about:')
        url = '' if blank else display(raw)
        host = '' if blank else host_of(raw)
        D = self.store.d
        s = D['settings']
        lang = s.get('language', 'uz')
        sh_on = bool(s['shields']) and host not in D['shieldsOff']
        acc = {'id': 'default', 'name': 'MR', 'color': '#9fd8ff'}
        return {
            'tabs': [{
                'id': x.id, 'title': x.title or display(x.view.get_uri() or '') or self.T('tab_new'),
                'favicon': x.favicon, 'loading': x.loading, 'pinned': x.pinned, 'audible': x.audible,
                'muted': x.muted, 'vis': True, 'accountId': None, 'accountColor': None, 'accountName': None,
            } for x in self.tabs],
            'active': t.id if t else None, 'url': url, 'sec': sec_level('' if blank else raw),
            'canBack': bool(v and v.can_go_back()), 'canFwd': bool(v and v.can_go_forward()),
            'loading': bool(t and t.loading),
            'bookmarked': bool(url) and any(b['url'] == raw for b in D['bookmarks']),
            'zoom': int(round((t.zoom if t else 1.0) * 100)), 'blocked': t.blocked if t else 0, 'host': host,
            'shieldsGlobal': bool(s['shields']), 'shieldsOn': sh_on, 'totalBlocked': D['totalBlocked'],
            'priv': False, 'bar': bool(s['bookmarksBar']), 'account': acc, 'accounts': [acc],
            'bookmarks': [{'id': b['id'], 'title': b['title'], 'url': b['url'], 'icon': b.get('icon', '')}
                          for b in D['bookmarks']],
            'dl': {'active': len([d for d in self.dls if d['state'] == 'progressing']), 'total': len(self.dls)},
            'perms': [{'id': pid, 'origin': p['origin'], 'label': p['label']}
                      for pid, p in self.perms.items() if p['tab'] is t],
            'maximized': self.is_maximized(), 'fullscreen': self.html_fs,
            'engine': (ENGINES.get(s['engine']) or ENGINES['google'])['name'], 'version': VERSION,
            'internal': False, 'blank': blank, 'tile': bool(self.tile), 'lang': lang,
            'strings': self.i18n.get(lang) or self.i18n.get('uz') or {},
            'theme': self.theme(), 'themePref': s.get('theme', 'dark'),
            'authRequired': False, 'cloudEmail': None,
        }

    # ---------- tabs ----------
    def tab_by_id(self, tid):
        for t in self.tabs:
            if t.id == tid:
                return t
        return None

    def new_tab(self, url=None, after=None, related=None, activate=True):
        t = Tab(self, self.next_id, related)
        self.next_id += 1
        idx = len(self.tabs)
        if after is not None:
            a = after if isinstance(after, Tab) else self.tab_by_id(after)
            if a in self.tabs:
                idx = self.tabs.index(a) + 1
        self.tabs.insert(idx, t)
        self.nb.insert_page(t.view, None, idx)
        t.view.show()
        if activate:
            self.activate(t)
        if url:
            t.home_blank = False
            t.view.load_uri(url)
        elif related is None:
            t.show_blank()
        self.schedule_push()
        return t

    def activate(self, t):
        if self.active is not None and self.active is not t:
            self.find_close()
        self.active = t
        if self.tile:
            self.apply_tiling()
        else:
            self.nb.set_current_page(self.tabs.index(t))
        if t.home_blank or not (t.view.get_uri() or '').strip() or (t.view.get_uri() or '').startswith('about:'):
            self.ui.grab_focus()
            self.send_ui('focus-address')
        else:
            t.view.grab_focus()
        self.schedule_push()

    def cycle_tabs(self, step=1):
        if len(self.tabs) < 2:
            return
        cur_idx = self.tabs.index(self.active) if self.active in self.tabs else 0
        new_idx = (cur_idx + step) % len(self.tabs)
        self.activate(self.tabs[new_idx])

    def switch_tab(self, tid=None, *a):
        t = self.tab_by_id(tid)
        if t:
            self.activate(t)

    def close_tab(self, tid=None, *a):
        t = self.tab_by_id(tid)
        if not t:
            return
        u = t.view.get_uri() or ''
        if re.match(r'^https?://', u):
            self.closed.append((u, self.tabs.index(t)))
            del self.closed[:-20]
        idx = self.tabs.index(t)
        self.tabs.remove(t)
        if t.view.get_parent():
            t.view.get_parent().remove(t.view)
        t.view.destroy()
        if not self.tabs:
            self.on_delete()
            Gtk.main_quit()
            return
        if self.active is t:
            self.active = None
            self.activate(self.tabs[min(idx, len(self.tabs) - 1)])
        elif self.tile:
            self.apply_tiling()
        self.schedule_push()

    def move_tab(self, tid=None, to=0, *a):
        t = self.tab_by_id(tid)
        if not t or to is None:
            return
        to = max(0, min(int(to), len(self.tabs) - 1))
        self.tabs.remove(t)
        self.tabs.insert(to, t)
        self.nb.reorder_child(t.view, to)
        self.schedule_push()

    def mute_tab(self, tid=None, *a):
        t = self.tab_by_id(tid)
        if t:
            t.muted = not t.muted
            try:
                t.view.set_is_muted(t.muted)
            except Exception:
                pass
            self.schedule_push()

    def reopen_tab(self):
        if self.closed:
            u, idx = self.closed.pop()
            self.new_tab(u)

    def focus_page(self):
        if self.active:
            self.active.view.grab_focus()

    # ---------- navigation ----------
    def engine_key(self):
        return self.store.d['settings'].get('engine', 'google')

    def navigate(self, text=None, *a):
        r = resolve_input(text, self.engine_key())
        t = self.active
        if r and t:
            t.home_blank = False
            t.view.load_uri(r[1])
            t.view.grab_focus()

    def open_url(self, url=None, new=False, *a):
        if not url:
            return
        t = self.active
        if new or t is None:
            self.new_tab(url, after=t)
        else:
            t.home_blank = False
            t.view.load_uri(url)
            t.view.grab_focus()

    def nav_do(self, what):
        t = self.active
        if not t:
            return
        v = t.view
        if what == 'back' and v.can_go_back():
            v.go_back()
        elif what == 'forward' and v.can_go_forward():
            v.go_forward()
        elif what == 'stop':
            v.stop_loading()

    def reload(self, hard=False, *a):
        t = self.active
        if t:
            if hard:
                t.view.reload_bypass_cache()
            else:
                t.view.reload()

    def set_overlay(self, open_=False, focus_page=False, *a):
        self.overlay_open = bool(open_)
        self.relayout()
        if not open_ and focus_page:
            self.focus_page()

    # ---------- commands ----------
    def clip(self, text):
        Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).set_text(text or '', -1)

    def set_html_fs(self, on):
        self.html_fs = bool(on)
        if on:
            self.fullscreen()
        else:
            self.unfullscreen()
        self.relayout()
        self.schedule_push()

    def tile_toggle(self):
        self.tile = not self.tile
        if self.tile and len(self.tabs) < 2:
            self.new_tab(activate=False)
        self.apply_tiling()
        self.schedule_push()

    def apply_tiling(self):
        if self.tile and len(self.tabs) > 1:
            cur_idx = self.tabs.index(self.active) if self.active in self.tabs else 0
            other_idx = (cur_idx + 1) % len(self.tabs)
            other_tab = self.tabs[other_idx]

            # Clear extra_nb of any prior views
            for child in list(self.extra_nb.get_children()):
                if child != other_tab.view:
                    self.extra_nb.remove(child)

            # Detach other_tab view from self.nb if needed
            if other_tab.view.get_parent() == self.nb:
                self.nb.remove(other_tab.view)

            if other_tab.view.get_parent() != self.extra_nb:
                self.extra_nb.append_page(other_tab.view, None)

            # Ensure self.active is visible in self.nb
            if self.active in self.tabs:
                p_num = self.nb.page_num(self.active.view)
                if p_num >= 0:
                    self.nb.set_current_page(p_num)

            self.extra_nb.show_all()

            # Set split position based on window width
            alloc = self.get_allocation()
            w = alloc.width if alloc.width > 200 else 1360
            pos = int(w * getattr(self, 'tile_ratio', 0.5))
            self.paned.set_position(pos)
        else:
            # Untile: return all tabs back into self.nb
            for child in list(self.extra_nb.get_children()):
                self.extra_nb.remove(child)
            self.extra_nb.hide()

            for i, tab in enumerate(self.tabs):
                if tab.view.get_parent() != self.nb:
                    if tab.view.get_parent():
                        tab.view.get_parent().remove(tab.view)
                    self.nb.insert_page(tab.view, None, i)
                    tab.view.show()

            if self.active in self.tabs:
                self.nb.set_current_page(self.tabs.index(self.active))

    def _on_paned_release(self, paned, event):
        alloc = paned.get_allocation()
        if alloc.width > 100:
            pos = paned.get_position()
            self.tile_ratio = max(0.1, min(0.9, pos / float(alloc.width)))
        return False

    def zoom_step(self, d):
        t = self.active
        if not t:
            return
        if d == 0:
            z = 1.0
        else:
            cur = min(range(len(ZOOMS)), key=lambda i: abs(ZOOMS[i] - t.zoom))
            z = ZOOMS[max(0, min(len(ZOOMS) - 1, cur + d))]
        t.zoom = z
        t.view.set_zoom_level(z)
        self.schedule_push()

    def toggle_bookmark(self):
        t = self.active
        if not t:
            return
        u = t.view.get_uri() or ''
        if not re.match(r'^https?://', u):
            return
        B = self.store.d['bookmarks']
        for b in B:
            if b['url'] == u:
                B.remove(b)
                break
        else:
            B.append({'id': self.store.d['nextBm'], 'title': t.title or u, 'url': u, 'icon': t.favicon})
            self.store.d['nextBm'] += 1
        self.store.save()
        self.schedule_push()

    def run_cmd(self, name=None, arg=None, *a):
        t = self.active
        if name == 'newtab':
            self.new_tab()
        elif name == 'reopen':
            self.reopen_tab()
        elif name == 'home':
            if t:
                t.home_blank = False
                t.view.load_uri(ENGINES.get(self.engine_key(), ENGINES['google'])['home'])
        elif name == 'bookmark-toggle':
            self.toggle_bookmark()
        elif name == 'bar-toggle':
            s = self.store.d['settings']
            s['bookmarksBar'] = not s['bookmarksBar']
            self.store.save()
            self.relayout()
            self.schedule_push()
        elif name == 'zoomin':
            self.zoom_step(1)
        elif name == 'zoomout':
            self.zoom_step(-1)
        elif name == 'zoomreset':
            self.zoom_step(0)
        elif name == 'fullscreen':
            if self.get_window() and (self.get_window().get_state() & Gdk.WindowState.FULLSCREEN):
                self.unfullscreen()
            else:
                self.fullscreen()
        elif name == 'print' and t:
            WebKit2.PrintOperation.new(t.view).run_dialog(self)
        elif name == 'viewsource' and t:
            u = t.view.get_uri() or ''
            if u:
                self.new_tab('view-source:' + u, after=t)
        elif name == 'devtools' and t:
            t.view.get_inspector().show()
        elif name in ('downloads',):
            self.send_ui('open-overlay', 'dl')
        elif name == 'tile-toggle':
            self.tile_toggle()
        else:
            print('[cmd] hozircha qo\'llab-quvvatlanmaydi:', name, file=sys.stderr)

    # ---------- find ----------
    def on_find(self, text=None, o=None, *a):
        t = self.active
        if not t:
            return
        fc = t.view.get_find_controller()
        if not text:
            fc.search_finish()
            t.find_text, t.find_idx, t.find_n = '', 0, 0
            self.send_ui('find-result', {'active': 0, 'matches': 0})
            return
        o = o or {}
        if o.get('findNext') and t.find_text == text and t.find_n:
            if o.get('forward', True):
                t.find_idx = t.find_idx % t.find_n + 1
                fc.search_next()
            else:
                t.find_idx = (t.find_idx - 2) % t.find_n + 1
                fc.search_previous()
            self.send_ui('find-result', {'active': t.find_idx, 'matches': t.find_n})
        else:
            t.find_text, t.find_idx = text, 1
            fc.search(text, WebKit2.FindOptions.CASE_INSENSITIVE | WebKit2.FindOptions.WRAP_AROUND, 1000)

    def find_close(self, *a):
        t = self.active
        if t:
            try:
                t.view.get_find_controller().search_finish()
            except Exception:
                pass

    def find_visible(self, v=False, *a):
        self.find_open = bool(v)
        self.relayout()

    # ---------- history / suggestions ----------
    def add_history(self, t):
        uri = t.view.get_uri() or ''
        if not re.match(r'^https?://', uri):
            return
        H = self.store.d['history']
        now = int(time.time() * 1000)
        for i, h in enumerate(H):
            if h['url'] == uri:
                h['count'] = h.get('count', 1) + 1
                h['ts'] = now
                h['title'] = t.title or h.get('title', '')
                H.insert(0, H.pop(i))
                break
        else:
            H.insert(0, {'url': uri, 'title': t.title, 'ts': now, 'count': 1})
            del H[3000:]
        self.store.save()

    def inv_suggest(self, reply, text=''):
        raw = (text or '').strip()
        q = re.sub(r'^www\.', '', re.sub(r'^https?://', '', raw.lower()))
        scored, seen = [], set()

        def push(it, score):
            key = it.get('url') or it.get('text')
            if key and key not in seen:
                seen.add(key)
                scored.append((score, it))
        if q:
            for t in self.tabs:
                u = t.view.get_uri() or ''
                if not re.match(r'^https?://', u):
                    continue
                h, ti = strip_url(u).lower(), (t.title or '').lower()
                s = 100 if h.startswith(q) else 70 if q in h else 50 if q in ti else 0
                if s:
                    push({'type': 'tab', 'title': t.title or u, 'url': u, 'icon': t.favicon}, s + 20)
            for b in self.store.d['bookmarks']:
                h, ti = strip_url(b['url']).lower(), (b.get('title') or '').lower()
                s = 90 if h.startswith(q) else 80 if ti.startswith(q) else 60 if q in h else 45 if q in ti else 0
                if s:
                    push({'type': 'bookmark', 'title': b.get('title') or b['url'], 'url': b['url'],
                          'icon': b.get('icon', '')}, s)
            now = time.time() * 1000
            for h in self.store.d['history'][:2000]:
                hs, ti = strip_url(h['url']).lower(), (h.get('title') or '').lower()
                bare = host_of(h['url']).replace('www.', '').lower()
                s = 75 if (bare.startswith(q) or hs.startswith(q)) else 72 if bare.split('.')[0] == q \
                    else 40 if (q in bare or q in hs) else 35 if ti.startswith(q) else 22 if q in ti else 0
                if not s:
                    continue
                age_days = max(0.0, (now - h.get('ts', now)) / 86400000.0)
                s += min(12.0, (h.get('count', 1)) ** 0.5 * 3) + max(0.0, 15 - age_days)
                push({'type': 'history', 'title': h.get('title') or h['url'], 'url': h['url'],
                      'icon': ''}, s)
        r = resolve_input(raw, self.engine_key())
        reply({'kind': r[0] if r else 'search', 'items': [it for _, it in sorted(scored, key=lambda x: -x[0])[:8]]})

    def inv_autocomplete(self, reply, text=''):
        t = (text or '').strip().lower()
        if not t or ' ' in t:
            return reply('')
        best, bs = '', -1
        for h in self.store.d['history'][:2000]:
            u = strip_url(h['url'])
            cand = u if '/' in t else u.split('/')[0]
            if cand.lower().startswith(t) and len(cand) > len(t) and h.get('count', 1) > bs:
                best, bs = cand, h.get('count', 1)
        reply(best)

    def inv_suggest_web(self, reply, text=''):
        q = (text or '').strip()
        if len(q) < 2:
            return reply([])
        eng = ENGINES.get(self.engine_key(), ENGINES['google'])
        url = eng['sug'].replace('%s', urllib.parse.quote(q))

        def work():
            out = []
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=1.5) as r:
                    j = json.loads(r.read().decode('utf-8', 'replace'))
                out = [x for x in (j[1] if len(j) > 1 else []) if isinstance(x, str) and x.strip()][:6]
            except Exception:
                pass
            GLib.idle_add(lambda: (reply(out), False)[1])
        threading.Thread(target=work, daemon=True).start()

    # ---------- shields ----------
    def apply_shields(self):
        try:
            self.tab_ucm.remove_all_filters()
        except Exception:
            return
        D = self.store.d
        if not D['settings']['shields']:
            return
        try:
            with open(SHIELDS_JSON, 'r', encoding='utf-8') as f:
                doms = json.load(f)['block']
            rules = [{'trigger': {'url-filter': '^https?://[^/]*' + re.escape(d).replace('\\-', '-') + '[/:?#]'},
                      'action': {'type': 'block'}} for d in doms]
            if D['shieldsOff']:
                rules.append({'trigger': {'url-filter': '.*', 'if-domain': ['*' + h for h in D['shieldsOff']]},
                              'action': {'type': 'ignore-previous-rules'}})
            fstore = WebKit2.UserContentFilterStore.new(os.path.join(DATA_DIR, 'filters'))
            data = GLib.Bytes.new(json.dumps(rules).encode('utf-8'))

            def done(src, res, _u=None):
                try:
                    flt = src.save_finish(res)
                    self.tab_ucm.add_filter(flt)
                except Exception as e:
                    print('[shields]', e, file=sys.stderr)
            fstore.save('mrb-shields-%d' % int(time.time()), data, None, done)
        except Exception as e:
            print('[shields]', e, file=sys.stderr)

    def shield_toggle(self, *a):
        t = self.active
        h = host_of(t.view.get_uri() or '') if t else ''
        if not h:
            return
        L = self.store.d['shieldsOff']
        if h in L:
            L.remove(h)
        else:
            L.append(h)
        self.store.save()
        self.apply_shields()
        GLib.timeout_add(400, lambda: (t.view.reload(), False)[1])
        self.schedule_push()

    # ---------- permissions ----------
    def add_permission(self, tab, req):
        label = 'ruxsat'
        try:
            if isinstance(req, WebKit2.GeolocationPermissionRequest):
                label = 'location'
            elif isinstance(req, WebKit2.NotificationPermissionRequest):
                label = 'notifications'
            elif isinstance(req, WebKit2.UserMediaPermissionRequest):
                label = 'camera / microphone'
        except Exception:
            pass
        self.perm_seq += 1
        self.perms[self.perm_seq] = {'req': req, 'tab': tab, 'origin': host_of(tab.view.get_uri() or ''), 'label': label}
        self.schedule_push()
        return True

    def perm_answer(self, pid=None, allow=False, remember=False, *a):
        p = self.perms.pop(pid, None)
        if p:
            try:
                p['req'].allow() if allow else p['req'].deny()
            except Exception:
                pass
        self.schedule_push()

    # ---------- downloads ----------
    def dl_list(self):
        return [{k: d[k] for k in ('id', 'name', 'received', 'total', 'state', 'paused', 'path')} for d in self.dls]

    def push_dl(self, force=False):
        now = time.time()
        if not force and now - self.last_dl_push < 0.25:
            return
        self.last_dl_push = now
        self.send_ui('downloads', self.dl_list())
        self.schedule_push()

    def on_download(self, ctx, dl):
        self.dl_seq += 1
        item = {'id': self.dl_seq, 'name': '', 'received': 0, 'total': 0, 'state': 'progressing',
                'paused': False, 'path': '', 'obj': dl}
        self.dls.insert(0, item)

        def decide(d, suggested):
            name = os.path.basename(suggested or 'download') or 'download'
            ddir = os.path.expanduser('~/Downloads')
            os.makedirs(ddir, exist_ok=True)
            path = os.path.join(ddir, name)
            base, ext = os.path.splitext(path)
            n = 1
            while os.path.exists(path):
                path = '%s (%d)%s' % (base, n, ext)
                n += 1
            item['name'], item['path'] = os.path.basename(path), path
            try:
                item['total'] = max(0, d.get_response().get_content_length())
            except Exception:
                pass
            d.set_destination(GLib.filename_to_uri(path, None))
            return True

        def received(d, n):
            item['received'] = d.get_received_data_length()
            self.push_dl()

        def finished(d):
            item['state'] = 'completed' if item['state'] == 'progressing' else item['state']
            item['received'] = item['received'] or item['total']
            self.push_dl(True)

        def failed(d, err):
            if item['state'] == 'progressing':
                item['state'] = 'interrupted'
            self.push_dl(True)
        dl.connect('decide-destination', decide)
        dl.connect('received-data', received)
        dl.connect('finished', finished)
        dl.connect('failed', failed)
        self.send_ui('dl-start')
        self.push_dl(True)

    def dl_action(self, did=None, act=None, *a):
        item = next((d for d in self.dls if d['id'] == did), None)
        if not item:
            return
        if act == 'cancel':
            item['state'] = 'cancelled'
            try:
                item['obj'].cancel()
            except Exception:
                pass
        elif act == 'open' and item['path']:
            try:
                Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(item['path'], None), None)
            except Exception:
                pass
        elif act == 'show' and item['path']:
            try:
                Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(os.path.dirname(item['path']), None), None)
            except Exception:
                pass
        elif act == 'remove':
            self.dls.remove(item)
        self.push_dl(True)

    # ---------- context menus (rendered by the classic UI) ----------
    def popup(self, tpl, x=80, y=80):
        items, acts, n = [], {}, 0
        for it in tpl:
            if not it:
                continue
            if it.get('sep'):
                items.append({'t': 's'})
                continue
            n += 1
            mid = 'm%d' % n
            items.append({'t': 'i', 'id': mid, 'label': it['label'], 'en': it.get('en', True), 'k': it.get('k', '')})
            acts[mid] = it
        if not items:
            return
        self.ctx_actions = acts
        self.overlay_open = True
        self.relayout()
        self.send_ui('ctx-menu', {'items': items, 'x': int(x or 80), 'y': int(y or 40)})

    def ctx_pick(self, mid=None, *a):
        it = self.ctx_actions.get(mid)
        self.ctx_actions = {}
        self.overlay_open = False
        self.relayout()
        if it and it.get('en', True) and it.get('fn'):
            try:
                it['fn']()
            except Exception:
                traceback.print_exc()

    def tab_menu(self, tid=None, x=80, y=40, *a):
        t = self.tab_by_id(tid)
        if not t:
            return
        i = self.tabs.index(t)
        url = t.view.get_uri() or ''
        has_url = bool(re.match(r'^https?://', url))
        T = self.T
        self.popup([
            {'label': T('new_tab'), 'k': 'Ctrl+T', 'fn': lambda: self.new_tab(after=t)}, {'sep': True},
            {'label': T('reload'), 'k': 'Ctrl+R', 'fn': t.view.reload},
            {'label': T('duplicate_tab'), 'en': has_url, 'fn': lambda: self.new_tab(url, after=t)},
            {'label': T('copy_url'), 'en': has_url, 'fn': lambda: self.clip(url)},
            {'label': T('unpin_tab') if t.pinned else T('pin_tab'), 'fn': lambda: self.pin_tab(t)},
            {'label': T('unmute') if t.muted else T('mute'), 'fn': lambda: self.mute_tab(t.id)}, {'sep': True},
            {'label': T('close_tab'), 'k': 'Ctrl+W', 'fn': lambda: self.close_tab(t.id)},
            {'label': T('close_other'), 'en': len(self.tabs) > 1,
             'fn': lambda: [self.close_tab(x.id) for x in list(self.tabs) if x is not t and not x.pinned]},
            {'label': T('close_right'), 'en': i < len(self.tabs) - 1,
             'fn': lambda: [self.close_tab(x.id) for x in list(self.tabs[i + 1:])]},
            {'label': T('reopen_tab'), 'en': bool(self.closed), 'k': 'Ctrl+Shift+T', 'fn': self.reopen_tab},
        ], x, y)

    def pin_tab(self, t):
        t.pinned = not t.pinned
        self.schedule_push()

    def bm_menu(self, bid=None, x=80, y=80, *a):
        b = next((b for b in self.store.d['bookmarks'] if b['id'] == bid), None)
        if not b:
            return
        T = self.T

        def delete():
            self.store.d['bookmarks'] = [z for z in self.store.d['bookmarks'] if z['id'] != bid]
            self.store.save()
            self.schedule_push()
        self.popup([
            {'label': T('open'), 'fn': lambda: self.open_url(b['url'])},
            {'label': T('open_new_tab'), 'fn': lambda: self.new_tab(b['url'], after=self.active)},
            {'label': T('copy_url'), 'fn': lambda: self.clip(b['url'])}, {'sep': True},
            {'label': T('delete'), 'fn': delete},
        ], x, y)

    # ---------- keyboard ----------
    def on_key(self, w, e):
        st = e.state
        ctrl = bool(st & Gdk.ModifierType.CONTROL_MASK)
        alt = bool(st & Gdk.ModifierType.MOD1_MASK)
        shift = bool(st & Gdk.ModifierType.SHIFT_MASK)
        k = Gdk.keyval_name(Gdk.keyval_to_lower(e.keyval)) or ''
        t = self.active
        if ctrl and not alt:
            if k == 't':
                self.reopen_tab() if shift else self.new_tab()
            elif k == 'w':
                t and self.close_tab(t.id)
            elif k == 'l':
                self.ui.grab_focus()
                self.send_ui('focus-address')
            elif k == 'r':
                self.reload(shift)
            elif k == 'f':
                self.send_ui('find-open')
            elif k == 'd':
                self.toggle_bookmark()
            elif k == 'p':
                self.run_cmd('print')
            elif k == 'u':
                self.run_cmd('viewsource')
            elif k == 'i' and shift:
                self.run_cmd('devtools')
            elif k in ('tab', 'iso_left_tab', 'page_down', 'page_up') and self.tabs:
                back = shift or k in ('iso_left_tab', 'page_up')
                i = self.tabs.index(t) if t in self.tabs else 0
                self.activate(self.tabs[(i + (-1 if back else 1)) % len(self.tabs)])
            elif k in ('left', 'h') and self.tabs:
                if shift:
                    cur = self.tabs.index(t) if t in self.tabs else 0
                    self.move_tab(t.id, max(0, cur - 1))
                else:
                    self.cycle_tabs(-1)
            elif k in ('right', 'l_key', 'l') and shift and self.tabs:
                cur = self.tabs.index(t) if t in self.tabs else 0
                self.move_tab(t.id, min(len(self.tabs) - 1, cur + 1))
            elif k in ('right', 'l') and not shift and self.tabs:
                self.cycle_tabs(1)
            elif k in ('backslash', 'bar'):
                self.tile_toggle()
            elif k in ('plus', 'equal', 'kp_add'):
                self.zoom_step(1)
            elif k in ('minus', 'kp_subtract'):
                self.zoom_step(-1)
            elif k in ('0', 'kp_0'):
                self.zoom_step(0)
            elif k.isdigit() and k != '0' and self.tabs:
                i = len(self.tabs) - 1 if k == '9' else min(int(k) - 1, len(self.tabs) - 1)
                self.activate(self.tabs[i])
            else:
                return False
            return True
        if alt and not ctrl:
            if k == 'left':
                self.nav_do('back')
            elif k == 'right':
                self.nav_do('forward')
            elif k == 'home':
                self.run_cmd('home')
            else:
                return False
            return True
        if k == 'f5':
            self.reload(ctrl)
        elif k == 'f6':
            self.ui.grab_focus()
            self.send_ui('focus-address')
        elif k == 'f11':
            self.run_cmd('fullscreen')
        elif k == 'f12':
            self.run_cmd('devtools')
        elif k == 'escape' and self.find_open:
            self.send_ui('find-hide')
            self.find_open = False
            self.find_close()
            self.relayout()
            self.focus_page()
        else:
            return False
        return True

    def on_delete(self, *a):
        self.store.flush()
        return False


def main():
    app = App()
    app.connect('destroy', Gtk.main_quit)
    try:
        signal.signal(signal.SIGINT, lambda *a: Gtk.main_quit())
    except Exception:
        pass
    app.show_all()
    Gtk.main()


if __name__ == '__main__':
    main()

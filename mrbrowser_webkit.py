#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MR Browser — Native WebKit Engine with Full Original UI
4-5 soat oldingi to'liq boy MR Browser UI'sini WebKit dvigatelida ishga tushirish.
"""

import sys
import os
import json
import gi

gi.require_version('Gtk', '3.0')
try:
    gi.require_version('WebKit2', '4.1')
except ValueError:
    gi.require_version('WebKit2', '4.0')

from gi.repository import Gtk, Gdk, WebKit2, GLib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UI_HTML_PATH = os.path.join(BASE_DIR, "src", "renderer", "chrome", "ui.html")
DATA_DIR = os.path.expanduser('~/.config/mrbrowser')
os.makedirs(DATA_DIR, exist_ok=True)
STORE_FILE = os.path.join(DATA_DIR, 'webkit_store.json')

DEFAULT_HOME = "https://duckduckgo.com"
SEARCH_TEMPLATE = "https://duckduckgo.com/?q={}"

def load_store():
    if os.path.exists(STORE_FILE):
        try:
            with open(STORE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "history": [],
        "bookmarks": [],
        "settings": {
            "shields": True,
            "bookmarksBar": True,
            "engine": "duckduckgo",
            "theme": "dark",
            "language": "uz"
        }
    }

def save_store(data):
    try:
        with open(STORE_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Store Error]: {e}", file=sys.stderr)


class MRBrowserApp(Gtk.Window):
    def __init__(self):
        super().__init__(title="MR Browser")
        self.set_default_size(1360, 840)
        self.store = load_store()
        self.tabs = []
        self.active_tab_index = 0
        self.tab_seq = 0

        # WebKit context
        data_manager = WebKit2.WebsiteDataManager(
            base_data_directory=os.path.join(DATA_DIR, "web_data"),
            base_cache_directory=os.path.join(DATA_DIR, "web_cache"),
        )
        self.web_context = WebKit2.WebContext.new_with_website_data_manager(data_manager)

        self._build_ui()
        self.new_tab(DEFAULT_HOME)

    def _build_ui(self):
        vbox = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.add(vbox)

        # 1. Top UI WebView (ui.html)
        ui_settings = WebKit2.Settings()
        ui_settings.set_enable_developer_extras(True)
        ui_settings.set_enable_javascript(True)

        user_content_manager = WebKit2.UserContentManager()
        user_content_manager.register_script_message_handler("mrb")
        user_content_manager.connect("script-message-received::mrb", self._on_ui_message)

        self.ui_view = WebKit2.WebView.new_with_user_content_manager(user_content_manager)
        self.ui_view.set_settings(ui_settings)
        self.ui_view.set_size_request(-1, 74)
        self.ui_view.connect("load-changed", self._on_ui_loaded)
        vbox.pack_start(self.ui_view, False, False, 0)

        # 2. Tabs Stack / Notebook
        self.notebook = Gtk.Notebook()
        self.notebook.set_show_tabs(False)
        self.notebook.set_show_border(False)
        vbox.pack_start(self.notebook, True, True, 0)

        # Load ui.html
        if os.path.exists(UI_HTML_PATH):
            self.ui_view.load_uri("file://" + UI_HTML_PATH)
        else:
            print("ui.html not found at", UI_HTML_PATH, file=sys.stderr)

    def _on_ui_loaded(self, view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            self.push_state()

    def current_tab(self):
        if 0 <= self.active_tab_index < len(self.tabs):
            return self.tabs[self.active_tab_index]
        return None

    def push_state(self):
        cur = self.current_tab()
        cur_url = cur["view"].get_uri() or "" if cur else ""
        can_back = cur["view"].can_go_back() if cur else False
        can_fwd = cur["view"].can_go_forward() if cur else False
        is_loading = cur["loading"] if cur else False

        state = {
            "tabs": [
                {
                    "id": t["id"],
                    "title": t["title"],
                    "favicon": "",
                    "loading": t["loading"],
                    "pinned": False,
                    "audible": False,
                    "muted": False,
                    "vis": True,
                    "accountId": "default",
                    "accountColor": "#9fd8ff",
                    "accountName": "Asosiy"
                }
                for t in self.tabs
            ],
            "active": cur["id"] if cur else None,
            "url": cur_url,
            "sec": "secure" if cur_url.startswith("https") else "insecure" if cur_url.startswith("http") else "internal",
            "canBack": can_back,
            "canFwd": can_fwd,
            "loading": is_loading,
            "bookmarked": any(b.get("url") == cur_url for b in self.store.get("bookmarks", [])),
            "zoom": 100,
            "blocked": 0,
            "host": cur_url.split('/')[2] if '://' in cur_url else '',
            "shieldsGlobal": True,
            "shieldsOn": True,
            "totalBlocked": 0,
            "priv": False,
            "bar": False,
            "account": {"id": "default", "name": "MR", "color": "#9fd8ff"},
            "accounts": [{"id": "default", "name": "MR", "color": "#9fd8ff"}],
            "bookmarks": self.store.get("bookmarks", []),
            "dl": {"active": 0, "total": 0},
            "perms": [],
            "maximized": False,
            "fullscreen": False,
            "engine": "DuckDuckGo",
            "version": "2.1.0 (WebKit)",
            "internal": False,
            "blank": not cur_url,
            "tile": False,
            "lang": "uz",
            "theme": "dark",
            "authRequired": False,
            "cloudEmail": None,
            "strings": {
                "tab_new": "Yangi tab",
                "search_or_address": "Qidiruv yoki manzil...",
                "blocked": "bloklandi"
            }
        }

        js = f"window.__mrbDispatch && window.__mrbDispatch('state', {json.dumps(state)});"
        self.ui_view.evaluate_javascript(js, -1, None, None, None, None, None)

    def new_tab(self, url=DEFAULT_HOME):
        self.tab_seq += 1
        tab_id = f"t{self.tab_seq}"

        tab_settings = WebKit2.Settings()
        tab_settings.set_enable_developer_extras(True)
        tab_settings.set_enable_javascript(True)
        tab_settings.set_enable_page_cache(True)
        tab_settings.set_user_agent_with_application_details("MRBrowser", "2.1")

        view = WebKit2.WebView.new_with_context(self.web_context)
        view.set_settings(tab_settings)

        tab_data = {
            "id": tab_id,
            "title": "Yangi tab",
            "url": url,
            "loading": False,
            "view": view
        }

        view.connect("notify::title", lambda v, p, td=tab_data: self._on_tab_title(td, v.get_title()))
        view.connect("notify::uri", lambda v, p, td=tab_data: self._on_tab_uri(td, v.get_uri()))
        view.connect("load-changed", lambda v, e, td=tab_data: self._on_tab_load(td, e))

        scrolled = Gtk.ScrolledWindow()
        scrolled.add(view)
        scrolled.show_all()

        page_num = self.notebook.append_page(scrolled, None)
        self.tabs.append(tab_data)
        self.active_tab_index = len(self.tabs) - 1
        self.notebook.set_current_page(page_num)

        self._load_url(tab_data, url)
        self.push_state()
        return tab_data

    def _load_url(self, tab, url):
        u = url.strip()
        if not u:
            return
        if not u.startswith(('http://', 'https://', 'file://', 'about:')):
            if '.' in u and ' ' not in u:
                u = 'https://' + u
            else:
                u = SEARCH_TEMPLATE.format(GLib.uri_escape_string(u, "", True))
        tab["url"] = u
        tab["view"].load_uri(u)

    def _on_tab_title(self, tab, title):
        if title:
            tab["title"] = title
            self.push_state()

    def _on_tab_uri(self, tab, uri):
        if uri:
            tab["url"] = uri
            self.push_state()

    def _on_tab_load(self, tab, event):
        if event == WebKit2.LoadEvent.STARTED:
            tab["loading"] = True
        elif event == WebKit2.LoadEvent.FINISHED:
            tab["loading"] = False
            # Tarixga yozish
            uri = tab["view"].get_uri()
            if uri and not uri.startswith('about:'):
                self.store["history"].insert(0, {"url": uri, "title": tab["title"]})
                if len(self.store["history"]) > 1000:
                    self.store["history"] = self.store["history"][:1000]
                save_store(self.store)
        self.push_state()

    def switch_tab(self, tab_id):
        for idx, t in enumerate(self.tabs):
            if t["id"] == tab_id:
                self.active_tab_index = idx
                self.notebook.set_current_page(idx)
                self.push_state()
                break

    def close_tab(self, tab_id):
        idx_to_remove = -1
        for idx, t in enumerate(self.tabs):
            if t["id"] == tab_id:
                idx_to_remove = idx
                break
        if idx_to_remove >= 0:
            self.notebook.remove_page(idx_to_remove)
            self.tabs.pop(idx_to_remove)
            if not self.tabs:
                self.new_tab(DEFAULT_HOME)
            else:
                self.active_tab_index = min(self.active_tab_index, len(self.tabs) - 1)
                self.notebook.set_current_page(self.active_tab_index)
                self.push_state()

    def _on_ui_message(self, manager, js_result):
        try:
            val = js_result.to_json(0)
            msg = json.loads(val)
        except Exception:
            return

        m_type = msg.get("type")
        channel = msg.get("channel")
        args = msg.get("args", [])
        msg_id = msg.get("id")

        cur = self.current_tab()

        if channel == "tab-new":
            self.new_tab(args[0] if args else DEFAULT_HOME)
        elif channel == "tab-select":
            if args:
                self.switch_tab(args[0])
        elif channel == "tab-close":
            if args:
                self.close_tab(args[0])
        elif channel == "nav":
            if args and cur:
                self._load_url(cur, args[0])
        elif channel == "back":
            if cur and cur["view"].can_go_back():
                cur["view"].go_back()
        elif channel == "forward":
            if cur and cur["view"].can_go_forward():
                cur["view"].go_forward()
        elif channel == "reload":
            if cur:
                cur["view"].reload()
        elif channel == "bookmark-add":
            if cur and cur["url"]:
                self.store["bookmarks"].append({"url": cur["url"], "title": cur["title"]})
                save_store(self.store)
                self.push_state()

        if m_type == "invoke" and msg_id is not None:
            reply_js = f"window.__mrbReply && window.__mrbReply({msg_id}, null, null);"
            self.ui_view.evaluate_javascript(reply_js, -1, None, None, None, None, None)


def main():
    app = MRBrowserApp()
    app.connect("destroy", Gtk.main_quit)
    app.show_all()
    Gtk.main()

if __name__ == '__main__':
    main()

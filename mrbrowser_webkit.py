#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MR Browser — WebKitGTK Edition
Haqiqiy WebKit rendering dvigatelida ishlaydigan zamonaviy, yengil brauzer.
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

from gi.repository import Gtk, Gdk, WebKit2, GLib, Gio

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
    return {"history": [], "bookmarks": []}

def save_store(data):
    try:
        with open(STORE_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Store Error]: {e}", file=sys.stderr)


class BrowserTab(Gtk.Box):
    def __init__(self, web_context, on_title_change=None, on_load_change=None):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.on_title_change = on_title_change
        self.on_load_change = on_load_change
        self.title = "Yangi tab"
        self.url = ""

        # WebKit Settings
        settings = WebKit2.Settings()
        settings.set_enable_developer_extras(True)
        settings.set_enable_javascript(True)
        settings.set_enable_page_cache(True)
        settings.set_user_agent_with_application_details("MRBrowser", "2.0")

        self.web_view = WebKit2.WebView.new_with_context(web_context)
        self.web_view.set_settings(settings)

        self.web_view.connect("notify::title", self._on_notify_title)
        self.web_view.connect("notify::uri", self._on_notify_uri)
        self.web_view.connect("load-changed", self._on_load_changed)

        # Scrolled window
        scrolled = Gtk.ScrolledWindow()
        scrolled.add(self.web_view)
        self.pack_start(scrolled, True, True, 0)
        self.show_all()

    def load_uri(self, uri):
        if not uri.startswith(('http://', 'https://', 'file://', 'about:')):
            if '.' in uri and ' ' not in uri:
                uri = 'https://' + uri
            else:
                uri = SEARCH_TEMPLATE.format(GLib.uri_escape_string(uri, "", True))
        self.web_view.load_uri(uri)

    def _on_notify_title(self, view, param):
        t = view.get_title()
        if t:
            self.title = t
            if self.on_title_change:
                self.on_title_change(self, t)

    def _on_notify_uri(self, view, param):
        u = view.get_uri()
        if u:
            self.url = u

    def _on_load_changed(self, view, event):
        if self.on_load_change:
            self.on_load_change(self, event)


class MRBrowserWebKit(Gtk.Window):
    def __init__(self):
        super().__init__(title="MR Browser (WebKit)")
        self.set_default_size(1200, 780)
        self.store = load_store()

        # WebKit context & cookie manager
        data_manager = WebKit2.WebsiteDataManager(
            base_data_directory=os.path.join(DATA_DIR, "web_data"),
            base_cache_directory=os.path.join(DATA_DIR, "web_cache"),
        )
        self.web_context = WebKit2.WebContext.new_with_website_data_manager(data_manager)

        self._setup_styles()
        self._build_ui()
        self.new_tab(DEFAULT_HOME)

    def _setup_styles(self):
        css_provider = Gtk.CssProvider()
        css = """
        window {
            background-color: #0c0d0e;
            color: #f1f3f4;
        }
        toolbar, .mrb-bar {
            background-color: #121316;
            border-bottom: 1px solid #23252a;
            padding: 6px 10px;
        }
        entry.mrb-omnibox {
            background-color: #1a1c22;
            color: #ffffff;
            border: 1px solid #2d3039;
            border-radius: 18px;
            padding: 6px 14px;
            font-size: 13px;
        }
        entry.mrb-omnibox:focus {
            border-color: #9fd8ff;
            background-color: #1e222b;
        }
        button.mrb-btn {
            background: transparent;
            color: #d1d5db;
            border: none;
            border-radius: 6px;
            padding: 4px 8px;
            font-weight: bold;
        }
        button.mrb-btn:hover {
            background-color: #252830;
            color: #9fd8ff;
        }
        notebook tab {
            background-color: #15161a;
            color: #8c9099;
            padding: 4px 12px;
            border: none;
            border-top: 2px solid transparent;
        }
        notebook tab:checked {
            background-color: #0c0d0e;
            color: #9fd8ff;
            border-top: 2px solid #9fd8ff;
        }
        """
        css_provider.load_from_data(css.encode('utf-8'))
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(),
            css_provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        )

    def _build_ui(self):
        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.add(main_box)

        # Toolbar / Navbar
        self.nav_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        self.nav_box.get_style_context().add_class('mrb-bar')

        self.btn_back = Gtk.Button(label="◀")
        self.btn_back.get_style_context().add_class('mrb-btn')
        self.btn_back.connect("clicked", self._on_back_clicked)
        self.nav_box.pack_start(self.btn_back, False, False, 0)

        self.btn_forward = Gtk.Button(label="▶")
        self.btn_forward.get_style_context().add_class('mrb-btn')
        self.btn_forward.connect("clicked", self._on_forward_clicked)
        self.nav_box.pack_start(self.btn_forward, False, False, 0)

        self.btn_reload = Gtk.Button(label="⟳")
        self.btn_reload.get_style_context().add_class('mrb-btn')
        self.btn_reload.connect("clicked", self._on_reload_clicked)
        self.nav_box.pack_start(self.btn_reload, False, False, 0)

        self.url_entry = Gtk.Entry()
        self.url_entry.get_style_context().add_class('mrb-omnibox')
        self.url_entry.set_placeholder_text("Qidiruv yoki URL manzilini kiriting...")
        self.url_entry.connect("activate", self._on_entry_activate)
        self.nav_box.pack_start(self.url_entry, True, True, 0)

        self.btn_bookmark = Gtk.Button(label="★")
        self.btn_bookmark.get_style_context().add_class('mrb-btn')
        self.btn_bookmark.connect("clicked", self._on_bookmark_clicked)
        self.nav_box.pack_start(self.btn_bookmark, False, False, 0)

        self.btn_new_tab = Gtk.Button(label="+")
        self.btn_new_tab.get_style_context().add_class('mrb-btn')
        self.btn_new_tab.connect("clicked", lambda b: self.new_tab(DEFAULT_HOME))
        self.nav_box.pack_start(self.btn_new_tab, False, False, 0)

        main_box.pack_start(self.nav_box, False, False, 0)

        # Tabs Container (Notebook)
        self.notebook = Gtk.Notebook()
        self.notebook.set_scrollable(True)
        self.notebook.connect("switch-page", self._on_tab_switched)
        main_box.pack_start(self.notebook, True, True, 0)

    def current_tab(self):
        page_num = self.notebook.get_current_page()
        if page_num >= 0:
            return self.notebook.get_nth_page(page_num)
        return None

    def new_tab(self, url=DEFAULT_HOME):
        tab = BrowserTab(self.web_context, self._on_tab_title_change, self._on_tab_load_change)
        
        # Tab sarlavhasi va yopish tugmasi
        tab_header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        label = Gtk.Label(label="Yuklanmoqda...")
        label.set_max_width_chars(18)
        label.set_ellipsize(Gtk.EllipsizeMode.END)
        tab._label = label
        tab_header.pack_start(label, True, True, 0)

        close_btn = Gtk.Button(label="✕")
        close_btn.get_style_context().add_class('mrb-btn')
        close_btn.connect("clicked", lambda btn: self.close_tab(tab))
        tab_header.pack_start(close_btn, False, False, 0)
        tab_header.show_all()

        page_index = self.notebook.append_page(tab, tab_header)
        self.notebook.show_all()
        self.notebook.set_current_page(page_index)

        tab.load_uri(url)
        return tab

    def close_tab(self, tab):
        page_num = self.notebook.page_num(tab)
        if page_num >= 0:
            self.notebook.remove_page(page_num)
        if self.notebook.get_n_pages() == 0:
            self.destroy()

    def _on_tab_switched(self, notebook, page, page_num):
        if page and hasattr(page, 'web_view'):
            uri = page.web_view.get_uri() or ""
            self.url_entry.set_text(uri)
            self._update_nav_buttons(page)

    def _on_tab_title_change(self, tab, title):
        if hasattr(tab, '_label'):
            tab._label.set_text(title or "Yangi tab")
        if tab == self.current_tab():
            self.set_title(f"{title} — MR Browser (WebKit)")

    def _on_tab_load_change(self, tab, event):
        if event == WebKit2.LoadEvent.COMMITTED:
            uri = tab.web_view.get_uri() or ""
            if tab == self.current_tab():
                self.url_entry.set_text(uri)
                self._update_nav_buttons(tab)
            # Tarixga qo'shish
            if uri and not uri.startswith("about:"):
                self.store["history"].insert(0, {"url": uri, "title": tab.title})
                if len(self.store["history"]) > 1000:
                    self.store["history"] = self.store["history"][:1000]
                save_store(self.store)

    def _update_nav_buttons(self, tab):
        if not tab:
            return
        wv = tab.web_view
        self.btn_back.set_sensitive(wv.can_go_back())
        self.btn_forward.set_sensitive(wv.can_go_forward())

    def _on_entry_activate(self, entry):
        text = entry.get_text().strip()
        tab = self.current_tab()
        if tab and text:
            tab.load_uri(text)

    def _on_back_clicked(self, btn):
        tab = self.current_tab()
        if tab and tab.web_view.can_go_back():
            tab.web_view.go_back()

    def _on_forward_clicked(self, btn):
        tab = self.current_tab()
        if tab and tab.web_view.can_go_forward():
            tab.web_view.go_forward()

    def _on_reload_clicked(self, btn):
        tab = self.current_tab()
        if tab:
            tab.web_view.reload()

    def _on_bookmark_clicked(self, btn):
        tab = self.current_tab()
        if tab and tab.url:
            self.store["bookmarks"].append({"url": tab.url, "title": tab.title})
            save_store(self.store)
            print(f"[MRBrowser] Xatcho'p saqlandi: {tab.url}")


def main():
    app = MRBrowserWebKit()
    app.connect("destroy", Gtk.main_quit)
    app.show_all()
    Gtk.main()

if __name__ == '__main__':
    main()

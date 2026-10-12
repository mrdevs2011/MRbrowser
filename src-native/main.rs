mod strip;

use gtk::glib;
use gtk::{gdk, gio};
use gtk4 as gtk;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use strip::{SIDE_W, ShellLayout, StripLayout, col_width, gap};
use webkit6::prelude::*;
use webkit6::WebView;

const START_PAGE: &str = r#"<!doctype html><meta charset=utf-8><meta name=color-scheme content=dark>
<style>
html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:#0d0e14;color:#7a83aa;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.w{text-align:center;max-width:700px;padding:20px}
.logo{font-size:64px;font-weight:700;letter-spacing:-.04em;margin:0 0 4px}
.logo span{background:linear-gradient(135deg,#9fd8ff,#fff);-webkit-background-clip:text;background-clip:text;color:transparent}
.logo b{color:#7aa2f7}
p.sub{margin:0 0 32px;color:#8a93bb;font-size:16px}
.k{display:grid;grid-template-columns:auto auto;gap:10px 28px;text-align:left;justify-content:center;background:#141724;border:1px solid #23273a;padding:24px 32px;border-radius:16px}
.k span:nth-child(odd){text-align:right}
kbd{font:12px ui-monospace,monospace;background:#1e2338;border:1px solid #333a5c;border-bottom-width:2px;
    border-radius:6px;padding:2px 7px;color:#c0caf5;margin-left:3px}
.shields-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(122,162,247,0.12);border:1px solid rgba(122,162,247,0.25);color:#7aa2f7;padding:6px 14px;border-radius:20px;font-size:12px;margin-bottom:20px}
</style>
<div class=w>
  <div class=shields-badge>🛡️ MR Shields Faol · WebKit6 Engine</div>
  <div class=logo><span>MR</span><b>Browser</b></div>
  <p class=sub>Tezkor, maxfiy va yonma-yon gorizontal tasma bilan boshqariluvchi brauzer</p>
  <div class=k>
    <span><kbd>Ctrl</kbd><kbd>G</kbd> / <kbd>L</kbd></span><span>Manzil / qidiruvga o‘tish</span>
    <span><kbd>Ctrl</kbd><kbd>Enter</kbd></span><span>Joriy URL manzilni tahrirlash</span>
    <span><kbd>Ctrl</kbd><kbd>T</kbd></span><span>Yangi tab ochish</span>
    <span><kbd>Ctrl</kbd><kbd>W</kbd></span><span>Tabni yopish</span>
    <span><kbd>Ctrl</kbd><kbd>F</kbd></span><span>To‘liq / Yarim ekran kengligi</span>
    <span><kbd>Ctrl</kbd><kbd>H</kbd> <kbd>L</kbd></span><span>Chap / O‘ng tabga fokus</span>
    <span><kbd>Ctrl</kbd><kbd>O</kbd></span><span>Umumiy ko‘rinish (Overview)</span>
    <span><kbd>Ctrl</kbd><kbd>B</kbd></span><span>Yon panelni yashirish / ko‘rsatish</span>
  </div>
</div>"#;

const CSS: &str = "
window { background: #0c0d12; border-radius: 0; box-shadow: none; }
label { color: #a9b1d6; }

/* ---- top bar ---- */
.top-bar {
    background: #12141c;
    border-bottom: 1px solid #202434;
    padding: 6px 12px;
}
.omnibox {
    background: #181c28;
    color: #e0e6fc;
    border: 1px solid #282f46;
    border-radius: 10px;
    padding: 4px 12px;
    font-size: 13.5px;
}
.omnibox:focus {
    border-color: #7aa2f7;
    background: #1d2232;
    box-shadow: 0 0 0 2px rgba(122, 162, 247, 0.25);
}

/* ---- action buttons ---- */
button.nav-btn {
    background: transparent;
    border: none;
    box-shadow: none;
    min-width: 32px;
    min-height: 32px;
    padding: 4px;
    border-radius: 8px;
    color: #8c97be;
}
button.nav-btn:hover {
    background: #1e2336;
    color: #c0caf5;
}
button.nav-btn.active {
    background: rgba(122, 162, 247, 0.18);
    color: #7aa2f7;
}

/* ---- tabs ---- */
.tab { border-radius: 12px; border: 2px solid #1a1e2d; }
.tab.focused { border-color: #7aa2f7; box-shadow: 0 0 16px rgba(122, 162, 247, 0.25); }

/* ---- sidebar ---- */
.brand { font-weight: 700; font-size: 18px; letter-spacing: -0.02em; color: #c0caf5; }
.brand-dot { color: #7aa2f7; }
button.flat-icon { background: transparent; border: none; box-shadow: none; min-width: 28px; min-height: 28px;
                   padding: 0; border-radius: 8px; color: #7982a9; }
button.flat-icon:hover { background: #1f2335; color: #c0caf5; }
button.pill { background: #181c28; border: 1px solid #282f46; border-radius: 10px; padding: 8px 12px;
              box-shadow: none; color: #a9b1d6; }
button.pill:hover { background: #1f2335; border-color: #3b4261; }
button.pill label { color: #c0caf5; }
.tablist, .tablist row { background: transparent; }
.tablist row { padding: 0; margin: 1px 0; border-radius: 10px; }
.tablist row:hover { background: #151824; }
.tablist row:selected { background: #22273d; }
.tabrow { padding: 8px 8px 8px 10px; }
.tabrow label { color: #8089b3; font-size: 13px; }
row:selected .tabrow label { color: #c0caf5; font-weight: 600; }
.tabrow image { color: #7982a9; }
.tab-close { opacity: 0; min-width: 22px; min-height: 22px; padding: 0; border-radius: 6px;
             background: transparent; border: none; box-shadow: none; color: #7982a9; transition: opacity 120ms; }
.tab-close:hover { background: #3b4261; color: #c0caf5; }
row:hover .tab-close, row:selected .tab-close { opacity: 1; }
.hint { color: #4b5275; font-size: 11px; }

.fav, .tabrow label.fav, row:selected .tabrow label.fav { border-radius: 5px; font-size: 10px; font-weight: 700; color: #0c0d12; }
.fav-0 { background: #7aa2f7; } .fav-1 { background: #bb9af7; } .fav-2 { background: #9ece6a; }
.fav-3 { background: #e0af68; } .fav-4 { background: #f7768e; } .fav-5 { background: #7dcfff; }
.fav-6 { background: #ff9e64; } .fav-7 { background: #73daca; }

/* ---- load progress ---- */
progressbar.load-bar { min-height: 3px; }
progressbar.load-bar trough { min-height: 3px; background: transparent; border: none; }
progressbar.load-bar progress { min-height: 3px; background: #7aa2f7; border-radius: 3px;
                                box-shadow: 0 0 10px rgba(122,162,247,0.8); }

/* ---- address palette ---- */
.palette { background: #181c28; border-radius: 16px; border: 1px solid #2e3650; padding: 16px 20px 12px;
           box-shadow: 0 24px 64px rgba(0,0,0,0.65); min-width: 620px; }
.palette image { color: #7aa2f7; }
entry.palette-entry, entry.palette-entry:focus-within { background: none; border: none; box-shadow: none; outline: none;
    padding: 0; min-height: 0; font-size: 19px; color: #c0caf5; }
.palette-hint { color: #626d97; font-size: 12px; margin-top: 8px; }

/* ---- overview ---- */
.zoomed .tab { opacity: 0.88; border-radius: 28px; }
.zoomed .tab.focused { opacity: 1; outline: 7px solid #7aa2f7; outline-offset: -5px; }
.ov-hint { background: #181c28; color: #9da6ce; border: 1px solid #2e3650; border-radius: 10px;
           padding: 8px 16px; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
";

const OV_ZOOM: f64 = 0.4;

struct Tab {
    view: WebView,
}

struct App {
    win: gtk::ApplicationWindow,
    shell: gtk::Box,
    shell_layout: ShellLayout,
    side: gtk::Box,
    strip: gtk::Box,
    layout: StripLayout,
    list: gtk::ListBox,
    pill_label: gtk::Label,
    top_omnibox: gtk::Entry,
    load_bar: gtk::ProgressBar,
    palette: gtk::Box,
    entry: gtk::Entry,
    ov_hint: gtk::Label,
    ov: Cell<bool>,
    ov_return: Cell<usize>,
    ov_saved: Cell<f64>,
    target_zoom: Cell<f64>,
    tabs: RefCell<Vec<Tab>>,
    focus: Cell<usize>,
    target: Cell<f64>,
    animating: Cell<bool>,
    side_open: Cell<bool>,
    side_gen: Cell<u32>,
    fresh: RefCell<Option<WebView>>,
}

fn to_uri(input: &str) -> String {
    let s = input.trim();
    if s.is_empty() || s == "about:start" {
        return "about:start".into();
    }
    if s.contains("://") || s.starts_with("about:") || s.starts_with("file:") {
        return s.into();
    }
    if s.starts_with("localhost") || s.starts_with("127.0.0.1") {
        return format!("http://{s}");
    }
    if !s.contains(' ') && s.contains('.') {
        return format!("https://{s}");
    }
    format!("https://duckduckgo.com/?q={}", glib::Uri::escape_string(s, None, false))
}

fn host_of(uri: &str) -> Option<String> {
    let u = glib::Uri::parse(uri, glib::UriFlags::NONE).ok()?;
    let h = u.host()?;
    Some(h.trim_start_matches("www.").to_string())
}

impl App {
    fn focused_view(&self) -> Option<WebView> {
        self.tabs.borrow().get(self.focus.get()).map(|t| t.view.clone())
    }

    fn palette_open(&self) -> bool {
        gtk::prelude::WidgetExt::is_visible(&self.palette)
    }

    fn overview_open(&self) -> bool {
        self.ov.get()
    }

    fn reveal_focus(self: &Rc<Self>) {
        let vw = self.strip.width() as f64;
        if vw <= 0.0 {
            return;
        }
        let visible = vw / self.target_zoom.get();
        let g = gap(self.target_zoom.get());
        let tabs = self.tabs.borrow();
        let mut x = 0.0;
        let mut span = None;
        for (i, t) in tabs.iter().enumerate() {
            let w = col_width(t.view.has_css_class("full"), vw);
            if i == self.focus.get() {
                span = Some((x, x + w));
            }
            x += w + g;
        }
        let total = x - g;
        let Some((l, r)) = span else { return };
        let max = (total - visible).max(0.0);
        let t = if self.ov.get() {
            if total <= visible {
                -(visible - total) / 2.0
            } else {
                ((l + r) / 2.0 - visible / 2.0).clamp(0.0, max)
            }
        } else {
            let mut t = self.target.get().clamp(0.0, max);
            if l < t {
                t = l;
            } else if r > t + visible {
                t = r - visible;
            }
            t.clamp(0.0, max)
        };
        self.target.set(t);
        drop(tabs);
        self.animate();
    }

    fn animate(self: &Rc<Self>) {
        if self.animating.get() {
            return;
        }
        let near = |a: f64, b: f64, eps: f64| (a - b).abs() < eps;
        if near(self.target.get(), self.layout.offset(), 0.5) && near(self.target_zoom.get(), self.layout.zoom(), 0.002) {
            self.layout.set_offset(self.target.get());
            self.layout.set_zoom(self.target_zoom.get());
            self.strip.queue_allocate();
            return;
        }
        self.animating.set(true);
        let app = self.clone();
        let last = Cell::new(None::<i64>);
        self.strip.add_tick_callback(move |strip, clock| {
            let now = clock.frame_time();
            let dt = last.replace(Some(now)).map_or(1.0 / 60.0, |l| (now - l) as f64 / 1e6);
            let k = 1.0 - (-dt / 0.06).exp();
            let w = (strip.width() as f64).max(1.0);
            let (oc, ot) = (app.layout.offset(), app.target.get());
            let (zc, zt) = (app.layout.zoom(), app.target_zoom.get());
            let (cc, ct) = (oc + w / (2.0 * zc), ot + w / (2.0 * zt));
            let mut cn = cc + (ct - cc) * k;
            let mut znext = zc + (zt - zc) * k;
            if near(ct, cn, 0.5) {
                cn = ct;
            }
            if near(zt, znext, 0.002) {
                znext = zt;
            }
            let next = if cn == ct && znext == zt { ot } else { cn - w / (2.0 * znext) };
            let tgt = ot;
            app.layout.set_offset(next);
            app.layout.set_zoom(znext);
            strip.queue_allocate();
            if next == tgt && znext == zt {
                app.animating.set(false);
                glib::ControlFlow::Break
            } else {
                glib::ControlFlow::Continue
            }
        });
    }

    fn update_pill(self: &Rc<Self>) {
        let text = self.focused_view().and_then(|v| v.uri()).map(|u| {
            if u == "about:start" {
                "Search or enter address".to_string()
            } else {
                host_of(&u).unwrap_or(u.to_string())
            }
        }).unwrap_or_else(|| "Search or enter address".into());
        self.pill_label.set_text(&text);
        
        let full_uri = self.focused_view().and_then(|v| v.uri()).map(|u| {
            if u == "about:start" { String::new() } else { u.to_string() }
        }).unwrap_or_default();
        if !self.top_omnibox.has_focus() {
            self.top_omnibox.set_text(&full_uri);
        }
    }

    fn focus_tab(self: &Rc<Self>, i: usize) {
        let tabs = self.tabs.borrow();
        if i >= tabs.len() || i == self.focus.get() {
            return;
        }
        if let Some(prev) = tabs.get(self.focus.get()) {
            prev.view.remove_css_class("focused");
        }
        self.focus.set(i);
        let curr = &tabs[i];
        curr.view.add_css_class("focused");
        curr.view.grab_focus();
        drop(tabs);

        self.list.select_row(self.list.row_at_index(i as i32).as_ref());
        self.update_pill();
        self.reveal_focus();
    }

    fn set_tab_full(self: &Rc<Self>, i: usize, full: bool) {
        let tabs = self.tabs.borrow();
        let Some(t) = tabs.get(i) else { return };
        if full {
            t.view.add_css_class("full");
        } else {
            t.view.remove_css_class("full");
        }
        drop(tabs);
        self.strip.queue_allocate();
        self.reveal_focus();
    }

    fn toggle_tab_full(self: &Rc<Self>) {
        let tabs = self.tabs.borrow();
        let Some(t) = tabs.get(self.focus.get()) else { return };
        let was_full = t.view.has_css_class("full");
        drop(tabs);
        self.set_tab_full(self.focus.get(), !was_full);
    }

    fn toggle_sidebar(self: &Rc<Self>) {
        let open = !self.side_open.get();
        self.side_open.set(open);
        self.side.set_visible(true);
        let side_id = self.side_gen.get().wrapping_add(1);
        self.side_gen.set(side_id);

        let app = self.clone();
        let (_from, to) = (self.shell_layout.side(), if open { SIDE_W as f64 } else { 0.0 });
        let last = Cell::new(None::<i64>);
        self.shell.add_tick_callback(move |shell, clock| {
            if app.side_gen.get() != side_id {
                return glib::ControlFlow::Break;
            }
            let now = clock.frame_time();
            let dt = last.replace(Some(now)).map_or(1.0 / 60.0, |l| (now - l) as f64 / 1e6);
            let k = 1.0 - (-dt / 0.06).exp();
            let curr = app.shell_layout.side();
            let mut next = curr + (to - curr) * k;
            if (to - next).abs() < 0.5 {
                next = to;
            }
            app.shell_layout.set_side(next);
            shell.queue_allocate();
            if next == to {
                if !open {
                    app.side.set_visible(false);
                }
                glib::ControlFlow::Break
            } else {
                glib::ControlFlow::Continue
            }
        });
    }

    fn enter_overview(self: &Rc<Self>) {
        if self.ov.get() {
            return;
        }
        self.ov.set(true);
        self.ov_return.set(self.focus.get());
        self.ov_saved.set(self.target.get());
        self.target_zoom.set(OV_ZOOM);
        self.strip.add_css_class("zoomed");
        self.ov_hint.set_visible(true);
        self.strip.set_can_target(true);
        self.reveal_focus();
    }

    fn exit_overview(self: &Rc<Self>, commit: bool) {
        if !self.ov.get() {
            return;
        }
        self.ov.set(false);
        self.target_zoom.set(1.0);
        self.strip.remove_css_class("zoomed");
        self.ov_hint.set_visible(false);
        self.strip.set_can_target(true);
        if !commit {
            self.focus_tab(self.ov_return.get());
            self.target.set(self.ov_saved.get());
            self.animate();
        } else {
            self.reveal_focus();
        }
        if let Some(v) = self.focused_view() {
            v.grab_focus();
        }
    }

    fn ov_click(self: &Rc<Self>, click_x: f64) {
        let vw = self.strip.width() as f64;
        let z = self.layout.zoom();
        let strip_x = self.layout.offset() + click_x / z;
        let tabs = self.tabs.borrow();
        let g = gap(z);
        let mut x = 0.0;
        for (i, t) in tabs.iter().enumerate() {
            let w = col_width(t.view.has_css_class("full"), vw);
            if strip_x >= x && strip_x <= x + w {
                drop(tabs);
                self.focus_tab(i);
                self.exit_overview(true);
                return;
            }
            x += w + g;
        }
    }

    fn show_palette(self: &Rc<Self>) {
        if self.overview_open() {
            self.exit_overview(false);
        }
        let cur = self.focused_view().and_then(|v| v.uri()).map(|u| {
            if u == "about:start" { String::new() } else { u.to_string() }
        }).unwrap_or_default();
        self.entry.set_text(&cur);
        self.entry.select_region(0, -1);
        self.palette.set_visible(true);
        self.entry.grab_focus();
    }

    fn hide_palette(self: &Rc<Self>) {
        if !self.palette_open() {
            return;
        }
        self.palette.set_visible(false);
        if let Some(v) = self.focused_view() {
            v.grab_focus();
        }
    }

    fn new_tab(self: &Rc<Self>) {
        let view = WebView::new();
        view.add_css_class("tab");
        view.set_hexpand(false);
        view.set_vexpand(true);

        if let Some(s) = webkit6::prelude::WebViewExt::settings(&view) {
            s.set_enable_developer_extras(true);
            s.set_enable_javascript(true);
            s.set_enable_page_cache(true);
            s.set_user_agent_with_application_details(Some("MRBrowser"), Some("2.1"));
        }

        let row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        row.add_css_class("tabrow");
        let fav = gtk::Label::new(Some("MR"));
        fav.add_css_class("fav");
        let cls = format!("fav-{}", (self.tabs.borrow().len()) % 8);
        fav.add_css_class(&cls);
        fav.set_width_chars(3);

        let label = gtk::Label::new(Some("Yangi tab"));
        label.set_hexpand(true);
        label.set_xalign(0.0);
        label.set_ellipsize(gtk::pango::EllipsizeMode::End);

        let close = gtk::Button::from_icon_name("window-close-symbolic");
        close.add_css_class("tab-close");
        row.append(&fav);
        row.append(&label);
        row.append(&close);

        let i = self.tabs.borrow().len();
        self.strip.append(&view);
        self.list.append(&row);
        self.tabs.borrow_mut().push(Tab { view: view.clone() });

        let app = self.clone();
        let v = view.clone();
        close.connect_clicked(move |_| {
            let tabs = app.tabs.borrow();
            if let Some(idx) = tabs.iter().position(|t| t.view == v) {
                drop(tabs);
                app.close_tab(idx);
            }
        });

        let app = self.clone();
        let l = label.clone();
        let f = fav.clone();
        view.connect_title_notify(move |v| {
            let title = v.title().map(|s| s.to_string()).unwrap_or_else(|| "Yangi tab".into());
            l.set_text(&title);
            let letter = title.chars().next().unwrap_or('M').to_uppercase().to_string();
            f.set_text(&letter);
            app.update_pill();
        });

        let app = self.clone();
        view.connect_uri_notify(move |_| {
            app.update_pill();
        });

        let app = self.clone();
        let v = view.clone();
        view.connect_estimated_load_progress_notify(move |view| {
            if app.focused_view().as_ref() == Some(&v) {
                let p = view.estimated_load_progress();
                app.load_bar.set_fraction(p);
                app.load_bar.set_visible(p < 1.0);
            }
        });

        view.load_html(START_PAGE, Some("about:start"));
        self.fresh.replace(Some(view));
        self.focus_tab(i);
    }

    fn close_tab(self: &Rc<Self>, i: usize) {
        let mut tabs = self.tabs.borrow_mut();
        if i >= tabs.len() {
            return;
        }
        let t = tabs.remove(i);
        self.strip.remove(&t.view);
        if let Some(row) = self.list.row_at_index(i as i32) {
            self.list.remove(&row);
        }
        let len = tabs.len();
        drop(tabs);

        if len == 0 {
            self.new_tab();
        } else {
            let next = if self.focus.get() >= len { len - 1 } else { self.focus.get().min(i) };
            self.focus.set(usize::MAX);
            self.focus_tab(next);
        }
    }

    fn navigate(self: &Rc<Self>, input: &str) {
        let uri = to_uri(input);
        if let Some(v) = self.focused_view() {
            if uri == "about:start" {
                v.load_html(START_PAGE, Some("about:start"));
            } else {
                v.load_uri(&uri);
            }
            self.fresh.replace(None);
        }
        self.hide_palette();
    }

    fn on_key(self: &Rc<Self>, key: gdk::Key, state: gdk::ModifierType) -> bool {
        let ctrl = state.contains(gdk::ModifierType::CONTROL_MASK);
        let name = key.name().unwrap_or_default();

        if self.palette_open() {
            if name == "Escape" {
                self.hide_palette();
                return true;
            }
            return false;
        }

        if self.overview_open() {
            match name.as_str() {
                "Escape" => { self.exit_overview(false); return true; }
                "Return" => { self.exit_overview(true); return true; }
                "h" | "Left" => {
                    let cur = self.focus.get();
                    if cur > 0 { self.focus_tab(cur - 1); }
                    return true;
                }
                "l" | "Right" => {
                    let cur = self.focus.get();
                    if cur + 1 < self.tabs.borrow().len() { self.focus_tab(cur + 1); }
                    return true;
                }
                "x" => { self.close_tab(self.focus.get()); return true; }
                _ => return true,
            }
        }

        if ctrl {
            match name.as_str() {
                "t" => { self.new_tab(); return true; }
                "w" => { self.close_tab(self.focus.get()); return true; }
                "g" | "l" => { self.show_palette(); return true; }
                "b" => { self.toggle_sidebar(); return true; }
                "f" => { self.toggle_tab_full(); return true; }
                "o" => { self.enter_overview(); return true; }
                "h" => {
                    let cur = self.focus.get();
                    if cur > 0 { self.focus_tab(cur - 1); }
                    return true;
                }
                "j" | "Tab" => {
                    let cur = self.focus.get();
                    let len = self.tabs.borrow().len();
                    if len > 0 { self.focus_tab((cur + 1) % len); }
                    return true;
                }
                "k" => {
                    let cur = self.focus.get();
                    let len = self.tabs.borrow().len();
                    if len > 0 { self.focus_tab(if cur == 0 { len - 1 } else { cur - 1 }); }
                    return true;
                }
                "Return" => { self.show_palette(); return true; }
                _ => {}
            }
        }

        false
    }
}

fn setup_storage() {
    let dir = glib::user_data_dir().join("mrbrowser");
    let _ = std::fs::create_dir_all(&dir);
    if let Some(cookies) = webkit6::NetworkSession::default().and_then(|s| s.cookie_manager()) {
        cookies.set_persistent_storage(
            dir.join("cookies.sqlite").to_str().unwrap_or("cookies.sqlite"),
            webkit6::CookiePersistentStorage::Sqlite,
        );
    }
}

fn build(gapp: &gtk::Application) {
    setup_storage();
    if let Some(s) = gtk::Settings::default() {
        s.set_gtk_application_prefer_dark_theme(true);
    }
    let provider = gtk::CssProvider::new();
    provider.load_from_string(CSS);
    gtk::style_context_add_provider_for_display(
        &gdk::Display::default().expect("no display"),
        &provider,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );

    // ---- sidebar ----
    let brand = gtk::Label::new(None);
    brand.set_markup("<span weight='bold' size='large' foreground='#c0caf5'>MR</span><span weight='bold' size='large' foreground='#7aa2f7'>Browser</span>");
    brand.set_hexpand(true);
    brand.set_xalign(0.0);
    let add = gtk::Button::from_icon_name("list-add-symbolic");
    add.add_css_class("flat-icon");
    add.set_tooltip_text(Some("Yangi tab (Ctrl+T)"));
    let head = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    head.set_margin_start(8);
    head.append(&brand);
    head.append(&add);

    let pill_label = gtk::Label::new(Some("Qidiruv yoki URL manzil"));
    pill_label.set_xalign(0.0);
    pill_label.set_hexpand(true);
    pill_label.set_ellipsize(gtk::pango::EllipsizeMode::End);
    pill_label.set_width_chars(1);
    let pill_inner = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    pill_inner.append(&gtk::Image::from_icon_name("system-search-symbolic"));
    pill_inner.append(&pill_label);
    let pill = gtk::Button::new();
    pill.add_css_class("pill");
    pill.set_child(Some(&pill_inner));
    pill.set_tooltip_text(Some("Manzilga o‘tish (Ctrl+G)"));

    let list = gtk::ListBox::new();
    list.add_css_class("tablist");
    list.set_selection_mode(gtk::SelectionMode::Single);
    list.set_activate_on_single_click(true);
    let list_scroll = gtk::ScrolledWindow::new();
    list_scroll.set_policy(gtk::PolicyType::Never, gtk::PolicyType::Automatic);
    list_scroll.set_vexpand(true);
    list_scroll.set_child(Some(&list));

    let hint = gtk::Label::new(Some("ctrl+b yashirish  ·  ctrl+o ko‘rinish"));
    hint.add_css_class("hint");
    hint.set_xalign(0.0);
    hint.set_margin_start(8);

    let side = gtk::Box::new(gtk::Orientation::Vertical, 10);
    side.set_margin_top(10);
    side.set_margin_bottom(10);
    side.set_margin_start(10);
    side.set_margin_end(2);
    side.append(&head);
    side.append(&pill);
    side.append(&list_scroll);
    side.append(&hint);

    // ---- top control bar ----
    let top_bar = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    top_bar.add_css_class("top-bar");

    let btn_sidebar = gtk::Button::from_icon_name("view-sidebar-start-symbolic");
    btn_sidebar.add_css_class("nav-btn");
    btn_sidebar.set_tooltip_text(Some("Yon panel (Ctrl+B)"));

    let btn_back = gtk::Button::from_icon_name("go-previous-symbolic");
    btn_back.add_css_class("nav-btn");
    btn_back.set_tooltip_text(Some("Orqaga"));

    let btn_forward = gtk::Button::from_icon_name("go-next-symbolic");
    btn_forward.add_css_class("nav-btn");
    btn_forward.set_tooltip_text(Some("Oldinga"));

    let btn_reload = gtk::Button::from_icon_name("view-refresh-symbolic");
    btn_reload.add_css_class("nav-btn");
    btn_reload.set_tooltip_text(Some("Qayta yuklash"));

    let btn_home = gtk::Button::from_icon_name("go-home-symbolic");
    btn_home.add_css_class("nav-btn");
    btn_home.set_tooltip_text(Some("Bosh sahifa"));

    let top_omnibox = gtk::Entry::new();
    top_omnibox.add_css_class("omnibox");
    top_omnibox.set_hexpand(true);
    top_omnibox.set_placeholder_text(Some("Qidiruv yoki manzil (masalan: google.com)..."));

    let btn_shields = gtk::Button::from_icon_name("security-high-symbolic");
    btn_shields.add_css_class("nav-btn");
    btn_shields.add_css_class("active");
    btn_shields.set_tooltip_text(Some("MR Shields Faol"));

    let btn_width = gtk::Button::from_icon_name("view-fullscreen-symbolic");
    btn_width.add_css_class("nav-btn");
    btn_width.set_tooltip_text(Some("Kenglik: Yarim / To‘liq (Ctrl+F)"));

    let btn_overview = gtk::Button::from_icon_name("view-grid-symbolic");
    btn_overview.add_css_class("nav-btn");
    btn_overview.set_tooltip_text(Some("Umumiy ko‘rinish (Ctrl+O)"));

    let btn_new_tab = gtk::Button::from_icon_name("tab-new-symbolic");
    btn_new_tab.add_css_class("nav-btn");
    btn_new_tab.set_tooltip_text(Some("Yangi tab (Ctrl+T)"));

    top_bar.append(&btn_sidebar);
    top_bar.append(&btn_back);
    top_bar.append(&btn_forward);
    top_bar.append(&btn_reload);
    top_bar.append(&btn_home);
    top_bar.append(&top_omnibox);
    top_bar.append(&btn_shields);
    top_bar.append(&btn_width);
    top_bar.append(&btn_overview);
    top_bar.append(&btn_new_tab);

    // ---- strip + shell ----
    let layout = StripLayout::new();
    let strip = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    strip.set_layout_manager(Some(layout.clone()));
    strip.set_overflow(gtk::Overflow::Hidden);
    strip.set_margin_top(8);
    strip.set_margin_bottom(8);
    strip.set_margin_end(8);
    strip.set_margin_start(6);

    let shell_layout = ShellLayout::new();
    shell_layout.set_side(SIDE_W as f64);
    let shell = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    shell.set_layout_manager(Some(shell_layout.clone()));
    shell.set_overflow(gtk::Overflow::Hidden);
    shell.set_hexpand(true);
    shell.set_vexpand(true);
    shell.append(&side);
    shell.append(&strip);

    let main_vbox = gtk::Box::new(gtk::Orientation::Vertical, 0);
    main_vbox.append(&top_bar);
    main_vbox.append(&shell);

    // ---- address palette ----
    let entry = gtk::Entry::new();
    entry.add_css_class("palette-entry");
    entry.set_hexpand(true);
    entry.set_placeholder_text(Some("Qidiruv yoki manzilni kiriting..."));
    let prow = gtk::Box::new(gtk::Orientation::Horizontal, 12);
    let sicon = gtk::Image::from_icon_name("system-search-symbolic");
    sicon.set_pixel_size(20);
    prow.append(&sicon);
    prow.append(&entry);
    let phint = gtk::Label::new(Some("Enter  o‘tish      Esc  bekor qilish"));
    phint.add_css_class("palette-hint");
    phint.set_xalign(0.0);
    let palette = gtk::Box::new(gtk::Orientation::Vertical, 0);
    palette.add_css_class("palette");
    palette.set_halign(gtk::Align::Center);
    palette.set_valign(gtk::Align::Start);
    palette.set_margin_top(110);
    palette.append(&prow);
    palette.append(&phint);
    palette.set_visible(false);

    // ---- overview hint ----
    let ov_hint = gtk::Label::new(Some("h / l  tanlash      Enter  ochish      x  yopish      Esc  chiqish"));
    ov_hint.add_css_class("ov-hint");
    ov_hint.set_halign(gtk::Align::Center);
    ov_hint.set_valign(gtk::Align::End);
    ov_hint.set_margin_bottom(28);
    ov_hint.set_can_target(false);
    ov_hint.set_visible(false);

    let load_bar = gtk::ProgressBar::new();
    load_bar.add_css_class("load-bar");
    load_bar.set_valign(gtk::Align::Start);
    load_bar.set_can_target(false);
    load_bar.set_visible(false);

    let overlay = gtk::Overlay::new();
    overlay.set_child(Some(&main_vbox));
    overlay.add_overlay(&load_bar);
    overlay.add_overlay(&palette);
    overlay.add_overlay(&ov_hint);

    let win = gtk::ApplicationWindow::builder()
        .application(gapp)
        .title("MR Browser")
        .default_width(1400)
        .default_height(850)
        .child(&overlay)
        .build();

    let app = Rc::new(App {
        win: win.clone(),
        shell: shell.clone(),
        shell_layout,
        side,
        strip,
        layout: layout.clone(),
        list: list.clone(),
        pill_label,
        top_omnibox: top_omnibox.clone(),
        load_bar,
        palette,
        entry: entry.clone(),
        ov_hint,
        ov: Cell::new(false),
        ov_return: Cell::new(0),
        ov_saved: Cell::new(0.0),
        target_zoom: Cell::new(1.0),
        tabs: RefCell::new(Vec::new()),
        focus: Cell::new(usize::MAX),
        target: Cell::new(0.0),
        animating: Cell::new(false),
        side_open: Cell::new(true),
        side_gen: Cell::new(0),
        fresh: RefCell::new(None),
    });

    let a = app.clone();
    layout.connect_resized(move || a.reveal_focus());
    let a = app.clone();
    list.connect_row_activated(move |_, row| a.focus_tab(row.index() as usize));
    let a = app.clone();
    add.connect_clicked(move |_| a.new_tab());
    let a = app.clone();
    pill.connect_clicked(move |_| a.show_palette());
    let a = app.clone();
    entry.connect_activate(move |e| a.navigate(&e.text()));
    let a = app.clone();
    top_omnibox.connect_activate(move |e| a.navigate(&e.text()));

    // Toolbar tugmalarini ulash
    let a = app.clone();
    btn_sidebar.connect_clicked(move |_| a.toggle_sidebar());
    let a = app.clone();
    btn_back.connect_clicked(move |_| {
        if let Some(v) = a.focused_view() { v.go_back(); }
    });
    let a = app.clone();
    btn_forward.connect_clicked(move |_| {
        if let Some(v) = a.focused_view() { v.go_forward(); }
    });
    let a = app.clone();
    btn_reload.connect_clicked(move |_| {
        if let Some(v) = a.focused_view() { v.reload(); }
    });
    let a = app.clone();
    btn_home.connect_clicked(move |_| {
        a.navigate("about:start");
    });
    let a = app.clone();
    btn_width.connect_clicked(move |_| a.toggle_tab_full());
    let a = app.clone();
    btn_overview.connect_clicked(move |_| {
        if a.overview_open() { a.exit_overview(false); } else { a.enter_overview(); }
    });
    let a = app.clone();
    btn_new_tab.connect_clicked(move |_| a.new_tab());

    let pick = gtk::GestureClick::new();
    let a = app.clone();
    pick.connect_released(move |_, _, x, _| {
        if a.ov.get() {
            a.ov_click(x);
        }
    });
    app.strip.add_controller(pick);

    let click = gtk::GestureClick::new();
    click.set_propagation_phase(gtk::PropagationPhase::Capture);
    let a = app.clone();
    click.connect_pressed(move |_, _, _, _| {
        if a.palette_open() {
            a.hide_palette();
        }
    });
    shell.add_controller(click);

    let keys = gtk::EventControllerKey::new();
    keys.set_propagation_phase(gtk::PropagationPhase::Capture);
    let a = app.clone();
    keys.connect_key_pressed(move |_, key, _, state| {
        if a.on_key(key, state) { glib::Propagation::Stop } else { glib::Propagation::Proceed }
    });
    win.add_controller(keys);

    app.new_tab();
    if let Some(url) = std::env::args().nth(1) {
        app.navigate(&url);
    }
    win.present();
}

fn main() -> glib::ExitCode {
    let app = gtk::Application::builder()
        .application_id("uz.mr.browser")
        .flags(gio::ApplicationFlags::NON_UNIQUE)
        .build();
    app.connect_activate(build);
    app.run_with_args::<&str>(&[])
}

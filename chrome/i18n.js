// =========================================================================
// ASS Subtitle Player - i18n.js
// Shared by content.js (on-page panels) and popup.js (extension popup).
// Default language is English; Turkish is offered as an additional option.
// =========================================================================

const I18N = {
    en: {
        ext_title: "Subtitle Player",
        enable_extension: "Enable extension",
        upload_primary: "Select subtitle (.ass, .srt)",
        load_last_primary: "Load last subtitle",
        tab_style: "Style", tab_sync: "Sync", tab_dual: "Dual", tab_search: "Search", tab_site: "Site", tab_keys: "Keys",
        size_label: "Size", opacity_label: "Opacity", edge_label: "Distance from bottom",
        text_color_label: "Text color", outline_color_label: "Outline color", outline_width_label: "Outline width",
        shadow_label: "Shadow", shadow_none: "None", shadow_normal: "Normal", shadow_strong: "Strong",
        font_label: "Font", ratio_label: "Aspect ratio", ratio_auto: "Auto (recommended)",
        ratio_169: "16:9", ratio_43: "4:3", ratio_vertical: "Vertical (Shorts/TikTok)",
        drag_mode_label: "Drag-to-position mode", drag_mode_hint: "When enabled, click and drag the subtitle box anywhere on the video.",
        delay_card_label: "Real-time delay", delay_minus_1: "−1s", delay_minus_01: "−0.1s", delay_plus_01: "+0.1s", delay_plus_1: "+1s",
        reset_btn: "Reset", bake_btn: "Apply permanently", bake_hint: "\"Apply permanently\" bakes the current delay into every line and resets the counter.",
        frame_shift_label: "Shift by frames", shift_btn: "Shift", fps_convert_label: "Convert FPS (permanent)", apply_btn: "Apply",
        profiles_label: "Sync profiles", save_tv: "Save TV", load_tv: "Load TV", save_bluray: "Save Blu-ray", load_bluray: "Load Blu-ray",
        autosync_btn: "Auto sync estimate (experimental)", autosync_hint: "Compares speech onsets to suggest a delay.",
        dual_toggle_label: "Dual subtitles (second language)", upload_secondary: "Select secondary subtitle", load_last_secondary: "Load last secondary subtitle",
        size2_label: "Secondary size", color2_label: "Secondary text color", dual_hint: "The secondary subtitle appears below or above the primary.",
        search_card_label: "Search OpenSubtitles", search_placeholder: "Movie / show title…",
        lang_tr: "Turkish", lang_en: "English", lang_ja: "Japanese", lang_all: "All languages",
        search_target_primary: "Target: primary subtitle", search_target_secondary: "Target: secondary subtitle",
        search_btn: "Search", search_enter_title: "Enter a title.", search_searching: "Searching…", search_no_results: "No results found.",
        search_results_found: "{count} result(s) found.", search_error: "Error: {error}", search_unknown_error: "no response received",
        download_btn: "⬇ Download & load", download_downloading: "Downloading…", download_error: "Error: {error}", download_unknown_error: "download failed", download_loaded: "✔ Loaded", search_downloads_suffix: "downloads",
        current_site_label: "Current site:", site_hint: "You can save Style settings specifically for this site.",
        save_site_btn: "Save for this site", reset_site_btn: "Reset", auto_restore_label: "Auto-remember last subtitle",
        key_delay_small: "Delay +0.1s / −0.1s", key_delay_big: "Delay +1s / −1s", key_delay_reset: "Reset delay",
        key_toggle_ext: "Toggle extension", key_toggle_dual: "Toggle dual subtitle", key_toggle_drag: "Toggle drag-to-position mode", keys_hint: "Shortcuts are fixed.",
        picker_title_primary: "Select Subtitle File", picker_title_secondary: "Select Secondary Subtitle", picker_drop_hint: "Drag and drop a file here, or choose one below.", picker_cancel: "Cancel",
        autosync_no_video: "No video found.", autosync_need_subtitle: "Load a subtitle file first.", autosync_analyzing: "Analyzing… play the video and wait.", autosync_drm_error: "Couldn't access the audio: {error}", autosync_not_enough_speech: "Not enough speech detected.", autosync_not_enough_cues: "Not enough subtitle lines in this window.", autosync_result: "Estimated delay: {offset}s (match score: {score}/{total}).", autosync_apply: "Apply", autosync_close: "Close",
        reset_all_settings: "Reset all settings", reset_all_confirm: "Are you sure you want to reset all settings?",
        toast_sub_loaded: "Subtitle successfully loaded!", toast_sub_loaded_sec: "Secondary subtitle loaded!", position_top_label: "Move to top (Toggle)", key_toggle_top: "Toggle position to top"
    },
    tr: {
        ext_title: "Subtitle Player",
        enable_extension: "Eklentiyi etkinleştir",
        upload_primary: "Altyazı seç (.ass, .srt)",
        load_last_primary: "Son altyazıyı yükle",
        tab_style: "Stil", tab_sync: "Senkron", tab_dual: "Çift Dil", tab_search: "Ara", tab_site: "Site", tab_keys: "Tuş",
        size_label: "Boyut", opacity_label: "Şeffaflık", edge_label: "Alt kenardan uzaklık",
        text_color_label: "Yazı rengi", outline_color_label: "Kenarlık rengi", outline_width_label: "Kenarlık kalınlığı",
        shadow_label: "Gölge", shadow_none: "Yok", shadow_normal: "Normal", shadow_strong: "Güçlü",
        font_label: "Yazı tipi", ratio_label: "Görüntü oranı", ratio_auto: "Otomatik (önerilen)",
        ratio_169: "16:9", ratio_43: "4:3", ratio_vertical: "Dikey (Shorts/TikTok)",
        drag_mode_label: "Sürükle-konumlandır modu", drag_mode_hint: "Açtığınızda altyazı kutusunu videonun üzerinde istediğiniz yere sürükleyebilirsiniz.",
        delay_card_label: "Gerçek zamanlı gecikme", delay_minus_1: "−1s", delay_minus_01: "−0.1s", delay_plus_01: "+0.1s", delay_plus_1: "+1s",
        reset_btn: "Sıfırla", bake_btn: "Kalıcı uygula", bake_hint: "\"Kalıcı uygula\" anlık gecikmeyi tüm satırlara işler ve sayacı sıfırlar.",
        frame_shift_label: "Kare (frame) bazlı kaydırma", shift_btn: "Kaydır", fps_convert_label: "FPS dönüştürme (kalıcı)", apply_btn: "Uygula",
        profiles_label: "Senkron profilleri", save_tv: "TV: Kaydet", load_tv: "TV: Yükle", save_bluray: "Blu-ray: Kaydet", load_bluray: "Blu-ray: Yükle",
        autosync_btn: "Otomatik senkron tahmini (deneysel)", autosync_hint: "Sesteki konuşma başlangıçlarını analiz eder.",
        dual_toggle_label: "Çift altyazı (ikinci dil)", upload_secondary: "İkincil altyazı seç", load_last_secondary: "Son ikincil altyazıyı yükle",
        size2_label: "İkincil boyut", color2_label: "İkincil yazı rengi", dual_hint: "İkincil altyazı birincil altyazının üstünde veya altında sıralanır.",
        search_card_label: "OpenSubtitles'da ara", search_placeholder: "Dizi / film adı…",
        lang_tr: "Türkçe", lang_en: "İngilizce", lang_ja: "Japonca", lang_all: "Tüm diller",
        search_target_primary: "Hedef: birincil altyazı", search_target_secondary: "Hedef: ikincil altyazı",
        search_btn: "Ara", search_enter_title: "Bir başlık girin.", search_searching: "Aranıyor…", search_no_results: "Sonuç bulunamadı.",
        search_results_found: "{count} sonuç bulundu.", search_error: "Hata: {error}", search_unknown_error: "yanıt alınamadı",
        download_btn: "⬇ İndir ve yükle", download_downloading: "İndiriliyor…", download_error: "Hata: {error}", download_unknown_error: "indirilemedi", download_loaded: "✔ Yüklendi", search_downloads_suffix: "indirme",
        current_site_label: "Şu anki site:", site_hint: "Stil ayarlarını bu siteye özel kaydedebilirsiniz.",
        save_site_btn: "Bu site için kaydet", reset_site_btn: "Sıfırla", auto_restore_label: "Son altyazıyı otomatik hatırla",
        key_delay_small: "Gecikme +0.1s / −0.1s", key_delay_big: "Gecikme +1s / −1s", key_delay_reset: "Gecikmeyi sıfırla",
        key_toggle_ext: "Eklentiyi aç/kapat", key_toggle_dual: "Çift altyazıyı aç/kapat", key_toggle_drag: "Sürükle-konumlandır", keys_hint: "Kısayollar sabittir.",
        picker_title_primary: "Altyazı Dosyası Seç", picker_title_secondary: "İkincil Altyazı Seç", picker_drop_hint: "Dosyayı sürükleyin veya seçin.", picker_cancel: "Vazgeç",
        autosync_no_video: "Video bulunamadı.", autosync_need_subtitle: "Önce altyazı yükleyin.", autosync_analyzing: "Analiz ediliyor…", autosync_drm_error: "Hata: {error}", autosync_not_enough_speech: "Yetersiz ses.", autosync_not_enough_cues: "Yetersiz satır.", autosync_result: "Tahmini: {offset}s ({score}/{total}).", autosync_apply: "Uygula", autosync_close: "Kapat",
        reset_all_settings: "Tüm ayarları sıfırla", reset_all_confirm: "Eklenti sıfırlansın mı?",
        toast_sub_loaded: "Altyazı başarıyla eklendi!", toast_sub_loaded_sec: "İkincil altyazı eklendi!", position_top_label: "Üste taşı (Aç/Kapat)", key_toggle_top: "Konumu üste/alta değiştir"
    }
};

function i18nText(key, lang, vars) {
    const dict = I18N[lang] || I18N.en;
    let str = dict[key] !== undefined ? dict[key] : (I18N.en[key] !== undefined ? I18N.en[key] : key);
    if (vars) { Object.keys(vars).forEach(k => { str = str.replace("{" + k + "}", vars[k]); }); }
    return str;
}

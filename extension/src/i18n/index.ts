export type Locale = "fr" | "en" | "ar" | "tr";

type Dict = Record<string, [string, string, string]>;

const messages: Dict = {
  NovaDownloader: ["NovaDownloader", "NovaDownloader", "NovaDownloader"],
  Nova: ["Nova", "Nova", "Nova"],
  "Glisser pour déplacer · double-clic pour réinitialiser": [
    "Drag to move · double-click to reset",
    "اسحب للنقل · نقر مزدوج لإعادة التعيين",
    "Sürükleyerek taşı · sıfırlamak için çift tıkla",
  ],
  "Télécharger cette vidéo": [
    "Download this video",
    "تنزيل هذا الفيديو",
    "Bu videoyu indir",
  ],
  Vidéo: ["Video", "فيديو", "Video"],
  "Sous-titres": ["Subtitles", "ترجمات", "Altyazılar"],
  "Analyse de la vidéo...": [
    "Analyzing video…",
    "جارٍ تحليل الفيديو…",
    "Video analiz ediliyor…",
  ],
  Télécharger: ["Download", "تنزيل", "İndir"],
  "Préparation...": ["Preparing…", "جارٍ التحضير…", "Hazırlanıyor…"],
  "Téléchargement lancé": [
    "Download started",
    "بدأ التنزيل",
    "İndirme başladı",
  ],
  "Télécharger l’audio": [
    "Download audio",
    "تنزيل الصوت",
    "Sesi indir",
  ],
  "Meilleure qualité": [
    "Best quality",
    "أفضل جودة",
    "En iyi kalite",
  ],
  "Télécharger MP3": ["Download MP3", "تنزيل MP3", "MP3 indir"],
  "Télécharger SRT": ["Download SRT", "تنزيل SRT", "SRT indir"],
  "Langue originale": ["Original language", "اللغة الأصلية", "Orijinal dil"],
  "Traduire vers": ["Translate into", "الترجمة إلى", "Çeviri dili"],
  "Version originale": [
    "Original version",
    "النسخة الأصلية",
    "Orijinal sürüm",
  ],
  Officiels: ["Official", "رسمية", "Resmî"],
  Automatiques: ["Automatic", "تلقائية", "Otomatik"],
  "Aucun sous-titre disponible": [
    "No subtitles available",
    "لا توجد ترجمات متاحة",
    "Altyazı mevcut değil",
  ],
  "Plus d’options sur NovaDownloader": [
    "More options on NovaDownloader",
    "المزيد من الخيارات على NovaDownloader",
    "NovaDownloader’da daha fazla seçenek",
  ],
  "Cette vidéo ne peut pas être analysée actuellement.": [
    "This video cannot be analyzed right now.",
    "تعذّر تحليل هذا الفيديو حاليًا.",
    "Bu video şu anda analiz edilemiyor.",
  ],
  "Impossible de contacter NovaDownloader.": [
    "Unable to reach NovaDownloader.",
    "تعذّر الاتصال بـ NovaDownloader.",
    "NovaDownloader’a ulaşılamıyor.",
  ],
  "Vérifiez votre connexion puis réessayez.": [
    "Check your connection and try again.",
    "تحقق من اتصالك ثم أعد المحاولة.",
    "Bağlantınızı kontrol edip yeniden deneyin.",
  ],
  Réessayer: ["Retry", "إعادة المحاولة", "Yeniden dene"],
  Fermer: ["Close", "إغلاق", "Kapat"],
  Preferred: ["Preferred", "مفضّل", "Tercih"],
  "Qualité audio": ["Audio quality", "جودة الصوت", "Ses kalitesi"],
  "Analyse de la vidéo…": [
    "Analyzing video…",
    "جارٍ تحليل الفيديو…",
    "Video analiz ediliyor…",
  ],
  "Aucun téléchargement pour le moment.": [
    "No downloads yet.",
    "لا توجد تنزيلات بعد.",
    "Henüz indirme yok.",
  ],
  Téléchargements: ["Downloads", "التنزيلات", "İndirmeler"],
  Retour: ["Back", "رجوع", "Geri"],
  "En cours": ["Active", "جارٍ", "Devam eden"],
  Terminés: ["Completed", "مكتملة", "Tamamlanan"],
  Échecs: ["Failed", "فاشلة", "Başarısız"],
  "Aucun téléchargement en cours.": [
    "No active downloads.",
    "لا توجد تنزيلات جارية.",
    "Aktif indirme yok.",
  ],
  "Aucun téléchargement terminé.": [
    "No completed downloads.",
    "لا توجد تنزيلات مكتملة.",
    "Tamamlanan indirme yok.",
  ],
  "Aucun échec récent.": [
    "No failed downloads.",
    "لا توجد إخفاقات حديثة.",
    "Başarısız indirme yok.",
  ],
  "Vous pouvez fermer NovaDownloader — le téléchargement continue dans votre navigateur.": [
    "You can close NovaDownloader — the download continues in your browser.",
    "يمكنك إغلاق NovaDownloader — سيستمر التنزيل في متصفحك.",
    "NovaDownloader’ı kapatabilirsiniz — indirme tarayıcınızda devam eder.",
  ],
  "Vidéo détectée": ["Video detected", "تم اكتشاف فيديو", "Video algılandı"],
  "Ouvrir les options de téléchargement": [
    "Open download options",
    "فتح خيارات التنزيل",
    "İndirme seçeneklerini aç",
  ],
  "Ouvrez une vidéo YouTube pour utiliser NovaDownloader.": [
    "Open a YouTube video to use NovaDownloader.",
    "افتح فيديو YouTube لاستخدام NovaDownloader.",
    "NovaDownloader’ı kullanmak için bir YouTube videosu açın.",
  ],
  "Ouvrir NovaDownloader": [
    "Open NovaDownloader",
    "فتح NovaDownloader",
    "NovaDownloader’ı aç",
  ],
  "Aucune vidéo YouTube détectée dans cet onglet.": [
    "No YouTube video detected in this tab.",
    "لم يتم اكتشاف فيديو YouTube في هذا التبويب.",
    "Bu sekmede YouTube videosu algılanmadı.",
  ],
  Paramètres: ["Settings", "الإعدادات", "Ayarlar"],
  "Qualité vidéo préférée": [
    "Preferred video quality",
    "جودة الفيديو المفضلة",
    "Tercih edilen video kalitesi",
  ],
  "Qualité audio préférée": [
    "Preferred audio quality",
    "جودة الصوت المفضلة",
    "Tercih edilen ses kalitesi",
  ],
  "Demander où enregistrer le fichier": [
    "Ask where to save the file",
    "السؤال عن مكان حفظ الملف",
    "Dosyanın nereye kaydedileceğini sor",
  ],
  Thème: ["Theme", "المظهر", "Tema"],
  Auto: ["Auto", "تلقائي", "Otomatik"],
  Clair: ["Light", "فاتح", "Açık"],
  Sombre: ["Dark", "داكن", "Koyu"],
  "Meilleure disponible": [
    "Best available",
    "الأفضل المتاح",
    "Mevcut en iyi",
  ],
  "La conversion n’améliore pas la qualité de la source.": [
    "Conversion does not improve source quality.",
    "التحويل لا يحسّن جودة المصدر.",
    "Dönüştürme kaynak kalitesini artırmaz.",
  ],
  "Extrayez la piste audio complète de la vidéo.": [
    "Extract the complete audio track.",
    "استخرج المسار الصوتي الكامل للفيديو.",
    "Videonun tüm ses parçasını çıkarın.",
  ],
  "Préparation de la vidéo...": [
    "Preparing video…",
    "جارٍ تجهيز الفيديو…",
    "Video hazırlanıyor…",
  ],
  "Non disponible": ["Unavailable", "غير متاح", "Kullanılamıyor"],
  "Respectez les droits d’auteur et les conditions d’utilisation applicables.": [
    "Respect copyright and applicable terms of use.",
    "احترم حقوق النشر وشروط الاستخدام المعمول بها.",
    "Telif haklarına ve geçerli kullanım koşullarına uyun.",
  ],
  Qualité: ["Quality", "الجودة", "Kalite"],
  Format: ["Format", "الصيغة", "Biçim"],
  Taille: ["Size", "الحجم", "Boyut"],
  Enregistrer: ["Save", "حفظ", "Kaydet"],
  "Aucun format vidéo disponible.": [
    "No video formats available.",
    "لا توجد صيغ فيديو متاحة.",
    "Video biçimi mevcut değil.",
  ],
};

export function detectLocale(preferred?: string): Locale {
  if (preferred && preferred !== "auto") {
    if (["fr", "en", "ar", "tr"].includes(preferred))
      return preferred as Locale;
  }
  const nav = (navigator.language || "fr").toLowerCase();
  if (nav.startsWith("en")) return "en";
  if (nav.startsWith("ar")) return "ar";
  if (nav.startsWith("tr")) return "tr";
  return "fr";
}

export function isRtl(locale: Locale): boolean {
  return locale === "ar";
}

export function t(key: string, locale: Locale): string {
  const entry = messages[key];
  if (!entry) return key;
  if (locale === "fr") return key;
  if (locale === "en") return entry[0];
  if (locale === "ar") return entry[1];
  return entry[2];
}

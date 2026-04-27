// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appName => 'مطعم المركزية';

  @override
  String get welcome => 'أهلاً بك';

  @override
  String get selectLanguage => 'اختر اللغة';

  @override
  String get arabic => 'العربية';

  @override
  String get english => 'English';

  @override
  String get continueBtn => 'استمرار';

  @override
  String get myOrders => 'طلباتي';

  @override
  String get activeOrders => 'الطلبات الحالية';

  @override
  String get orderHistory => 'سجل الطلبات';

  @override
  String get favorites => 'المفضلة';

  @override
  String get settings => 'الإعدادات';

  @override
  String get darkMode => 'الوضع الليلي';

  @override
  String get language => 'اللغة';

  @override
  String get noFavorites => 'قائمة المفضلة فارغة';

  @override
  String get addFavoritePlates => 'أضف أطباقك المفضلة لتجدها هنا بسرعة';

  @override
  String get logout => 'تسجيل الخروج';

  @override
  String get home => 'الرئيسية';

  @override
  String get cart => 'السلة';

  @override
  String get pending => 'قيد الانتظار';

  @override
  String get preparing => 'يُحضَّر';

  @override
  String get ready => 'جاهز';

  @override
  String get delivered => 'تم التسليم';

  @override
  String get noActiveOrders => 'لا توجد طلبات نشطة حالياً';

  @override
  String get noHistoryOrders => 'سجل الطلبات فارغ';

  @override
  String get invoiceDetails => 'تفاصيل الفاتورة';

  @override
  String get orderIdLabel => 'طلبية #';

  @override
  String get totalAmount => 'القيمة الإجمالية';

  @override
  String get reorder => 'إعادة الطلب';

  @override
  String get rateOrder => 'تقييم الطلب';

  @override
  String get cancel => 'إلغاء';

  @override
  String get confirm => 'تأكيد';

  @override
  String get close => 'إغلاق';

  @override
  String get addToCart => 'إضافة إلى السلة';

  @override
  String get addedToCart => 'تمت الإضافة للسلة بنجاح ✅';

  @override
  String selectRequired(Object name) {
    return 'يرجى اختيار $name أولاً ⚠️';
  }

  @override
  String get required => 'إجباري';

  @override
  String get optional => 'اختياري';

  @override
  String get notes => 'ملاحظات إضافية';

  @override
  String get notesHint => 'بدون بصل، محمص زيادة...';

  @override
  String get customerReviews => 'تقييمات العملاء';

  @override
  String get noReviews =>
      'لا توجد تقييمات حتى الآن. كن أول من يقيّم هذا الطبق!';

  @override
  String get addReview => 'أضف تقييمك';

  @override
  String get reviewDialogTitle => 'ما رأيك في هذا الطبق؟';

  @override
  String get reviewHint => 'شاركنا تجربتك (اختياري)';

  @override
  String get submitReview => 'إرسال التقييم';

  @override
  String get reviewSuccess => 'شكراً لتقييمك! ستتم مراجعته قريباً ✅';

  @override
  String get cartTitle => 'سلة المشتريات';

  @override
  String get emptyCart => 'سلتك فارغة';

  @override
  String get addPlates => 'أضف أطباقاً لذيذة';

  @override
  String get clearCart => 'مسح السلة';

  @override
  String get clearCartConfirm => 'هل أنت متأكد أنك تريد إفراغ السلة بالكامل؟';

  @override
  String get items => 'عناصر';

  @override
  String get totalPriceLabel => 'الإجمالي الكلي';

  @override
  String get confirmOrder => 'تأكيد الطلب';

  @override
  String get currency => 'د.أ';

  @override
  String get reorderConfirm =>
      'هل تريد إضافة جميع محتويات هذا الطلب إلى سلتك الحالية؟';

  @override
  String get ratingHint => 'أضف ملاحظاتك هنا...';

  @override
  String get brandSubtitle => 'شيف فود';

  @override
  String get delivery => 'توصيل';

  @override
  String get takeaway => 'سفري';

  @override
  String get orderTypeLabel => 'نوع الطلب:';

  @override
  String get nameLabel => 'الاسم (مطلوب)';

  @override
  String get phoneLabel => 'الهاتف (مطلوب)';

  @override
  String get nameRequired => 'مطلوب إدخال الاسم';

  @override
  String get phoneRequired => 'مطلوب إدخال الهاتف';

  @override
  String get deliveryAddress => 'عنوان التوصيل 📍';

  @override
  String get zoneLabel => 'المنطقة *';

  @override
  String get streetLabel => 'الشارع *';

  @override
  String get buildingLabel => 'رقم البناية / المنزل';

  @override
  String get selectZoneHint => 'اختر منطقة التوصيل...';

  @override
  String get searchZoneHint => 'ابحث عن منطقتك...';

  @override
  String get noZonesFound => 'لا توجد مناطق تطابق بحثك';

  @override
  String get pickupTimeLabel => 'وقت الاستلام:';

  @override
  String get asap => 'استلام الطلب أول ما يجهز';

  @override
  String get atTime => 'في وقت معين';

  @override
  String get selectTime => 'اختر الوقت';

  @override
  String get orderSummary => 'ملخص الطلب:';

  @override
  String get subtotal => 'المجموع الفرعي:';

  @override
  String get deliveryFee => 'رسوم التوصيل:';

  @override
  String get finalTotal => 'الإجمالي النهائي:';

  @override
  String get confirmOrderNow => 'تأكيد الطلب الآن';

  @override
  String get orderConfirmedMsg => 'تم تأكيد طلبك بنجاح! 🎉';

  @override
  String get selectZoneError => 'الرجاء اختيار منطقة التوصيل';

  @override
  String get logoutConfirm => 'هل أنت متأكد أنك تريد تسجيل الخروج؟';

  @override
  String get whatsAppError => 'تعذر فتح الواتساب. تأكد من تثبيت التطبيق.';

  @override
  String get phoneError => 'تعذر فتح تطبيق الاتصال.';

  @override
  String get supportError => 'خطأ في الاتصال بالدعم.';

  @override
  String get loyaltyPoints => 'نقاط الولاء';

  @override
  String get points => 'نقطة';

  @override
  String get notifications => 'الإشعارات';

  @override
  String get guest => 'مستخدم';

  @override
  String get phoneNotAvailable => 'رقم الجوال غير متوفر';

  @override
  String get loginTitle => 'تسجيل الدخول';

  @override
  String get loginTab => 'دخول';

  @override
  String get registerTab => 'حساب جديد';

  @override
  String get fullNameLabel => 'الاسم الكامل';

  @override
  String get email => 'البريد الإلكتروني';

  @override
  String get password => 'كلمة المرور';

  @override
  String get loginSuccessMsg => 'تم تسجيل الدخول بنجاح';

  @override
  String get registerSuccessMsg => 'تم إنشاء الحساب بنجاح';

  @override
  String get fieldsReviewMsg => 'يرجى مراجعة الحقول المطلوبة';

  @override
  String get allFieldsRequiredMsg => 'يرجى إكمال جميع البيانات المطلوبة';

  @override
  String get registerAction => 'تسجيل الحساب';

  @override
  String get startingFrom => 'يبدأ من';

  @override
  String get newTag => 'جديد';

  @override
  String get categoryAll => 'الكل';

  @override
  String get welcomeTitle => 'أهلاً وسهلاً';

  @override
  String get welcomeDesc =>
      'في مطعم المركزية، نُقدم لك أشهى المأكولات وأفضل الخدمات لتجربة طعام لا تُنسى.';

  @override
  String get backToHome => 'العودة للرئيسية';

  @override
  String get asSelected => 'حسب الاختيار';

  @override
  String get bestseller => '🔥 الأكثر طلباً';

  @override
  String get noDishesFound => 'لم يتم العثور على أطباق';

  @override
  String get retry => 'إعادة المحاولة';

  @override
  String get notificationsTitle => 'الإشعارات';

  @override
  String get noNotifications => 'لا توجد إشعارات حالياً';

  @override
  String get notificationDetails => 'تفاصيل الإشعار';

  @override
  String notificationExpiry(int days) {
    return 'ستنتهي صلاحية هذا التنبيه خلال $days أيام';
  }

  @override
  String get messageContent => 'محتوى الرسالة:';

  @override
  String get whatsapp => 'واتساب';

  @override
  String get support => 'الدعم';

  @override
  String get unknownCustomer => 'عميل مجهول';

  @override
  String get connectionError => 'تعذر الاتصال بالخادم. تأكد من تشغيل الخدمة.';

  @override
  String get orderSendError => 'تعذر إرسال الطلب';

  @override
  String get loginFailed => 'فشل تسجيل الدخول';

  @override
  String get registerFailed => 'فشل إنشاء الحساب';

  @override
  String get reviewFailed => 'فشل في إرسال التقييم';

  @override
  String get prepTime => '20 - 30 دقيقة';

  @override
  String get inRoute => 'في الطريق';

  @override
  String get waitingCancellation => 'بانتظار الإلغاء';

  @override
  String get cancelOrder => 'إلغاء الطلب';

  @override
  String get cancelReasonTitle => 'لماذا تود إلغاء الطلب؟';

  @override
  String get cancelReason1 => 'اخترت صنفاً خاطئاً';

  @override
  String get cancelReason2 => 'تأخر المطعم في تجهيز الطلب';

  @override
  String get cancelReason3 => 'الأصناف المختارة غير متوفرة';

  @override
  String get cancelReason4 => 'أسباب أخرى';

  @override
  String get otherReasonNote =>
      'طلب الإلغاء قيد المراجعة، سيتواصل معك فريق خدمة العملاء خلال 3-5 دقائق، أو يمكنك الاتصال بهم مباشرةً';

  @override
  String get callSupport => 'اتصل بخدمة العملاء العامة';

  @override
  String get selectBranch => 'اختر الفرع *';

  @override
  String get branchMadina => 'فرع شارع المدينة';

  @override
  String get branchKhalda => 'فرع خلدة';

  @override
  String get branchRequired => 'يرجى اختيار الفرع أولاً';

  @override
  String get searchPlaceholder => 'ابحث عن طبق أو صنف...';

  @override
  String get searchResults => 'نتائج البحث';

  @override
  String get recentSearches => 'عمليات البحث الأخيرة';

  @override
  String get noResultsFound => 'لم يتم العثور على نتائج';

  @override
  String get biometricReason => 'أثبت هويتك للدخول إلى حسابك';

  @override
  String get biometricEnableReason => 'أثبت هويتك لتفعيل الدخول بالبصمة';

  @override
  String get biometricAuthFailed => 'فشل التحقق من البصمة';

  @override
  String get biometricNotAvailable => 'البصمة غير متوفرة في هذا الجهاز';

  @override
  String get loginWithFingerprint => 'الدخول بالبصمة';

  @override
  String get biometricEnabled => 'تم تفعيل الدخول بالبصمة بنجاح ✅';

  @override
  String get forgotPassword => 'نسيت كلمة المرور؟';

  @override
  String get loginRequired => 'تسجيل الدخول مطلوب';

  @override
  String get loginToOrderMessage =>
      'يرجى تسجيل الدخول لتتمكن من إتمام الطلب ومتابعة حالته.';

  @override
  String get minOrderWarningPrefix => 'الحد الأدنى للطلب لهذه المنطقة هو ';

  @override
  String get minOrderWarningMissing => ' (ينقصك ';

  @override
  String get cartChangedError =>
      'تغيرت محتويات السلة! يرجى مراجعة الطلب مرة أخرى.';

  @override
  String get priceChangedError =>
      'تغيرت الأسعار في السلة! يرجى مراجعة الطلب مرة أخرى.';

  @override
  String get minOrderError => 'لم يتم الوصول للحد الأدنى للطلب';

  @override
  String get addressAreaLabel => 'المنطقة';

  @override
  String get addressStreetLabel => 'الشارع';

  @override
  String get addressBuildingLabel => 'البناية';

  @override
  String get otpEmailPrompt => 'يرجى إدخال الكود المرسل لبريدك الإلكتروني';

  @override
  String get laterBtn => 'لاحقاً';

  @override
  String get activateBtn => 'تفعيل';

  @override
  String get cancelOrderSuccess => 'تم إرسال طلب الإلغاء بنجاح';

  @override
  String get cancelOrderFailed => 'فشل الإلغاء: ';

  @override
  String get loginToSeeOrdersMsg => 'يرجى تسجيل الدخول لعرض الطلبات.';

  @override
  String get fetchOrdersFailedMsg => 'فشل في جلب الطلبات: ';

  @override
  String get cancellationRejected => 'تم رفض طلب الإلغاء';

  @override
  String get updatedBadge => 'تم التحديث!';

  @override
  String get phoneNumberLabel => 'رقم الجوال';

  @override
  String get invalidPhoneError => 'يرجى إدخال رقم جوال صحيح';

  @override
  String get passwordLengthError => 'كلمة المرور يجب أن تكون 8 أحرف على الأقل';

  @override
  String get resetPasswordPrompt =>
      'أدخل بريدك الإلكتروني وسنرسل لك كود لإعادة تعيين كلمة المرور';

  @override
  String get emailSentMsg => 'إذا كان البريد مسجلاً، ستصلك رسالة قريباً';

  @override
  String get sendCodeBtn => 'إرسال الكود';

  @override
  String get resetPasswordTitle => 'إعادة تعيين كلمة المرور';

  @override
  String resetPasswordDesc(String email) {
    return 'أدخل الكود المرسل إلى $email وكلمة المرور الجديدة';
  }

  @override
  String get otpCodeLengthError => 'أدخل الكود المكوّن من 6 أرقام';

  @override
  String get newPasswordLabel => 'كلمة المرور الجديدة';

  @override
  String get confirmPasswordLabel => 'تأكيد كلمة المرور';

  @override
  String get passwordsNotMatchError => 'كلمتا المرور غير متطابقتين';

  @override
  String get passwordResetSuccess => 'تم تعيين كلمة المرور بنجاح ✅';

  @override
  String get resetPasswordAction => 'تعيين كلمة المرور';

  @override
  String get verificationCodeTitle => 'كود التحقق';

  @override
  String get biometricDialogTitle => 'تفعيل الدخول بالبصمة';

  @override
  String get biometricDialogDesc =>
      'هل تريد تفعيل الدخول بالبصمة لتسريع الوصول إلى حسابك في المستقبل؟';
}

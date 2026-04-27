import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en')
  ];

  /// No description provided for @appName.
  ///
  /// In ar, this message translates to:
  /// **'مطعم المركزية'**
  String get appName;

  /// No description provided for @welcome.
  ///
  /// In ar, this message translates to:
  /// **'أهلاً بك'**
  String get welcome;

  /// No description provided for @selectLanguage.
  ///
  /// In ar, this message translates to:
  /// **'اختر اللغة'**
  String get selectLanguage;

  /// No description provided for @arabic.
  ///
  /// In ar, this message translates to:
  /// **'العربية'**
  String get arabic;

  /// No description provided for @english.
  ///
  /// In ar, this message translates to:
  /// **'English'**
  String get english;

  /// No description provided for @continueBtn.
  ///
  /// In ar, this message translates to:
  /// **'استمرار'**
  String get continueBtn;

  /// No description provided for @myOrders.
  ///
  /// In ar, this message translates to:
  /// **'طلباتي'**
  String get myOrders;

  /// No description provided for @activeOrders.
  ///
  /// In ar, this message translates to:
  /// **'الطلبات الحالية'**
  String get activeOrders;

  /// No description provided for @orderHistory.
  ///
  /// In ar, this message translates to:
  /// **'سجل الطلبات'**
  String get orderHistory;

  /// No description provided for @favorites.
  ///
  /// In ar, this message translates to:
  /// **'المفضلة'**
  String get favorites;

  /// No description provided for @settings.
  ///
  /// In ar, this message translates to:
  /// **'الإعدادات'**
  String get settings;

  /// No description provided for @darkMode.
  ///
  /// In ar, this message translates to:
  /// **'الوضع الليلي'**
  String get darkMode;

  /// No description provided for @language.
  ///
  /// In ar, this message translates to:
  /// **'اللغة'**
  String get language;

  /// No description provided for @noFavorites.
  ///
  /// In ar, this message translates to:
  /// **'قائمة المفضلة فارغة'**
  String get noFavorites;

  /// No description provided for @addFavoritePlates.
  ///
  /// In ar, this message translates to:
  /// **'أضف أطباقك المفضلة لتجدها هنا بسرعة'**
  String get addFavoritePlates;

  /// No description provided for @logout.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الخروج'**
  String get logout;

  /// No description provided for @home.
  ///
  /// In ar, this message translates to:
  /// **'الرئيسية'**
  String get home;

  /// No description provided for @cart.
  ///
  /// In ar, this message translates to:
  /// **'السلة'**
  String get cart;

  /// No description provided for @pending.
  ///
  /// In ar, this message translates to:
  /// **'قيد الانتظار'**
  String get pending;

  /// No description provided for @preparing.
  ///
  /// In ar, this message translates to:
  /// **'يُحضَّر'**
  String get preparing;

  /// No description provided for @ready.
  ///
  /// In ar, this message translates to:
  /// **'جاهز'**
  String get ready;

  /// No description provided for @delivered.
  ///
  /// In ar, this message translates to:
  /// **'تم التسليم'**
  String get delivered;

  /// No description provided for @noActiveOrders.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد طلبات نشطة حالياً'**
  String get noActiveOrders;

  /// No description provided for @noHistoryOrders.
  ///
  /// In ar, this message translates to:
  /// **'سجل الطلبات فارغ'**
  String get noHistoryOrders;

  /// No description provided for @invoiceDetails.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل الفاتورة'**
  String get invoiceDetails;

  /// No description provided for @orderIdLabel.
  ///
  /// In ar, this message translates to:
  /// **'طلبية #'**
  String get orderIdLabel;

  /// No description provided for @totalAmount.
  ///
  /// In ar, this message translates to:
  /// **'القيمة الإجمالية'**
  String get totalAmount;

  /// No description provided for @reorder.
  ///
  /// In ar, this message translates to:
  /// **'إعادة الطلب'**
  String get reorder;

  /// No description provided for @rateOrder.
  ///
  /// In ar, this message translates to:
  /// **'تقييم الطلب'**
  String get rateOrder;

  /// No description provided for @cancel.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء'**
  String get cancel;

  /// No description provided for @confirm.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد'**
  String get confirm;

  /// No description provided for @close.
  ///
  /// In ar, this message translates to:
  /// **'إغلاق'**
  String get close;

  /// No description provided for @addToCart.
  ///
  /// In ar, this message translates to:
  /// **'إضافة إلى السلة'**
  String get addToCart;

  /// No description provided for @addedToCart.
  ///
  /// In ar, this message translates to:
  /// **'تمت الإضافة للسلة بنجاح ✅'**
  String get addedToCart;

  /// No description provided for @selectRequired.
  ///
  /// In ar, this message translates to:
  /// **'يرجى اختيار {name} أولاً ⚠️'**
  String selectRequired(Object name);

  /// No description provided for @required.
  ///
  /// In ar, this message translates to:
  /// **'إجباري'**
  String get required;

  /// No description provided for @optional.
  ///
  /// In ar, this message translates to:
  /// **'اختياري'**
  String get optional;

  /// No description provided for @notes.
  ///
  /// In ar, this message translates to:
  /// **'ملاحظات إضافية'**
  String get notes;

  /// No description provided for @notesHint.
  ///
  /// In ar, this message translates to:
  /// **'بدون بصل، محمص زيادة...'**
  String get notesHint;

  /// No description provided for @customerReviews.
  ///
  /// In ar, this message translates to:
  /// **'تقييمات العملاء'**
  String get customerReviews;

  /// No description provided for @noReviews.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد تقييمات حتى الآن. كن أول من يقيّم هذا الطبق!'**
  String get noReviews;

  /// No description provided for @addReview.
  ///
  /// In ar, this message translates to:
  /// **'أضف تقييمك'**
  String get addReview;

  /// No description provided for @reviewDialogTitle.
  ///
  /// In ar, this message translates to:
  /// **'ما رأيك في هذا الطبق؟'**
  String get reviewDialogTitle;

  /// No description provided for @reviewHint.
  ///
  /// In ar, this message translates to:
  /// **'شاركنا تجربتك (اختياري)'**
  String get reviewHint;

  /// No description provided for @submitReview.
  ///
  /// In ar, this message translates to:
  /// **'إرسال التقييم'**
  String get submitReview;

  /// No description provided for @reviewSuccess.
  ///
  /// In ar, this message translates to:
  /// **'شكراً لتقييمك! ستتم مراجعته قريباً ✅'**
  String get reviewSuccess;

  /// No description provided for @cartTitle.
  ///
  /// In ar, this message translates to:
  /// **'سلة المشتريات'**
  String get cartTitle;

  /// No description provided for @emptyCart.
  ///
  /// In ar, this message translates to:
  /// **'سلتك فارغة'**
  String get emptyCart;

  /// No description provided for @addPlates.
  ///
  /// In ar, this message translates to:
  /// **'أضف أطباقاً لذيذة'**
  String get addPlates;

  /// No description provided for @clearCart.
  ///
  /// In ar, this message translates to:
  /// **'مسح السلة'**
  String get clearCart;

  /// No description provided for @clearCartConfirm.
  ///
  /// In ar, this message translates to:
  /// **'هل أنت متأكد أنك تريد إفراغ السلة بالكامل؟'**
  String get clearCartConfirm;

  /// No description provided for @items.
  ///
  /// In ar, this message translates to:
  /// **'عناصر'**
  String get items;

  /// No description provided for @totalPriceLabel.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي الكلي'**
  String get totalPriceLabel;

  /// No description provided for @confirmOrder.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الطلب'**
  String get confirmOrder;

  /// No description provided for @currency.
  ///
  /// In ar, this message translates to:
  /// **'د.أ'**
  String get currency;

  /// No description provided for @reorderConfirm.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد إضافة جميع محتويات هذا الطلب إلى سلتك الحالية؟'**
  String get reorderConfirm;

  /// No description provided for @ratingHint.
  ///
  /// In ar, this message translates to:
  /// **'أضف ملاحظاتك هنا...'**
  String get ratingHint;

  /// No description provided for @brandSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'شيف فود'**
  String get brandSubtitle;

  /// No description provided for @delivery.
  ///
  /// In ar, this message translates to:
  /// **'توصيل'**
  String get delivery;

  /// No description provided for @takeaway.
  ///
  /// In ar, this message translates to:
  /// **'سفري'**
  String get takeaway;

  /// No description provided for @orderTypeLabel.
  ///
  /// In ar, this message translates to:
  /// **'نوع الطلب:'**
  String get orderTypeLabel;

  /// No description provided for @nameLabel.
  ///
  /// In ar, this message translates to:
  /// **'الاسم (مطلوب)'**
  String get nameLabel;

  /// No description provided for @phoneLabel.
  ///
  /// In ar, this message translates to:
  /// **'الهاتف (مطلوب)'**
  String get phoneLabel;

  /// No description provided for @nameRequired.
  ///
  /// In ar, this message translates to:
  /// **'مطلوب إدخال الاسم'**
  String get nameRequired;

  /// No description provided for @phoneRequired.
  ///
  /// In ar, this message translates to:
  /// **'مطلوب إدخال الهاتف'**
  String get phoneRequired;

  /// No description provided for @deliveryAddress.
  ///
  /// In ar, this message translates to:
  /// **'عنوان التوصيل 📍'**
  String get deliveryAddress;

  /// No description provided for @zoneLabel.
  ///
  /// In ar, this message translates to:
  /// **'المنطقة *'**
  String get zoneLabel;

  /// No description provided for @streetLabel.
  ///
  /// In ar, this message translates to:
  /// **'الشارع *'**
  String get streetLabel;

  /// No description provided for @buildingLabel.
  ///
  /// In ar, this message translates to:
  /// **'رقم البناية / المنزل'**
  String get buildingLabel;

  /// No description provided for @selectZoneHint.
  ///
  /// In ar, this message translates to:
  /// **'اختر منطقة التوصيل...'**
  String get selectZoneHint;

  /// No description provided for @searchZoneHint.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن منطقتك...'**
  String get searchZoneHint;

  /// No description provided for @noZonesFound.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد مناطق تطابق بحثك'**
  String get noZonesFound;

  /// No description provided for @pickupTimeLabel.
  ///
  /// In ar, this message translates to:
  /// **'وقت الاستلام:'**
  String get pickupTimeLabel;

  /// No description provided for @asap.
  ///
  /// In ar, this message translates to:
  /// **'استلام الطلب أول ما يجهز'**
  String get asap;

  /// No description provided for @atTime.
  ///
  /// In ar, this message translates to:
  /// **'في وقت معين'**
  String get atTime;

  /// No description provided for @selectTime.
  ///
  /// In ar, this message translates to:
  /// **'اختر الوقت'**
  String get selectTime;

  /// No description provided for @orderSummary.
  ///
  /// In ar, this message translates to:
  /// **'ملخص الطلب:'**
  String get orderSummary;

  /// No description provided for @subtotal.
  ///
  /// In ar, this message translates to:
  /// **'المجموع الفرعي:'**
  String get subtotal;

  /// No description provided for @deliveryFee.
  ///
  /// In ar, this message translates to:
  /// **'رسوم التوصيل:'**
  String get deliveryFee;

  /// No description provided for @finalTotal.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي النهائي:'**
  String get finalTotal;

  /// No description provided for @confirmOrderNow.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الطلب الآن'**
  String get confirmOrderNow;

  /// No description provided for @orderConfirmedMsg.
  ///
  /// In ar, this message translates to:
  /// **'تم تأكيد طلبك بنجاح! 🎉'**
  String get orderConfirmedMsg;

  /// No description provided for @selectZoneError.
  ///
  /// In ar, this message translates to:
  /// **'الرجاء اختيار منطقة التوصيل'**
  String get selectZoneError;

  /// No description provided for @logoutConfirm.
  ///
  /// In ar, this message translates to:
  /// **'هل أنت متأكد أنك تريد تسجيل الخروج؟'**
  String get logoutConfirm;

  /// No description provided for @whatsAppError.
  ///
  /// In ar, this message translates to:
  /// **'تعذر فتح الواتساب. تأكد من تثبيت التطبيق.'**
  String get whatsAppError;

  /// No description provided for @phoneError.
  ///
  /// In ar, this message translates to:
  /// **'تعذر فتح تطبيق الاتصال.'**
  String get phoneError;

  /// No description provided for @supportError.
  ///
  /// In ar, this message translates to:
  /// **'خطأ في الاتصال بالدعم.'**
  String get supportError;

  /// No description provided for @loyaltyPoints.
  ///
  /// In ar, this message translates to:
  /// **'نقاط الولاء'**
  String get loyaltyPoints;

  /// No description provided for @points.
  ///
  /// In ar, this message translates to:
  /// **'نقطة'**
  String get points;

  /// No description provided for @notifications.
  ///
  /// In ar, this message translates to:
  /// **'الإشعارات'**
  String get notifications;

  /// No description provided for @guest.
  ///
  /// In ar, this message translates to:
  /// **'مستخدم'**
  String get guest;

  /// No description provided for @phoneNotAvailable.
  ///
  /// In ar, this message translates to:
  /// **'رقم الجوال غير متوفر'**
  String get phoneNotAvailable;

  /// No description provided for @loginTitle.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الدخول'**
  String get loginTitle;

  /// No description provided for @loginTab.
  ///
  /// In ar, this message translates to:
  /// **'دخول'**
  String get loginTab;

  /// No description provided for @registerTab.
  ///
  /// In ar, this message translates to:
  /// **'حساب جديد'**
  String get registerTab;

  /// No description provided for @fullNameLabel.
  ///
  /// In ar, this message translates to:
  /// **'الاسم الكامل'**
  String get fullNameLabel;

  /// No description provided for @email.
  ///
  /// In ar, this message translates to:
  /// **'البريد الإلكتروني'**
  String get email;

  /// No description provided for @password.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور'**
  String get password;

  /// No description provided for @loginSuccessMsg.
  ///
  /// In ar, this message translates to:
  /// **'تم تسجيل الدخول بنجاح'**
  String get loginSuccessMsg;

  /// No description provided for @registerSuccessMsg.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء الحساب بنجاح'**
  String get registerSuccessMsg;

  /// No description provided for @fieldsReviewMsg.
  ///
  /// In ar, this message translates to:
  /// **'يرجى مراجعة الحقول المطلوبة'**
  String get fieldsReviewMsg;

  /// No description provided for @allFieldsRequiredMsg.
  ///
  /// In ar, this message translates to:
  /// **'يرجى إكمال جميع البيانات المطلوبة'**
  String get allFieldsRequiredMsg;

  /// No description provided for @registerAction.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الحساب'**
  String get registerAction;

  /// No description provided for @startingFrom.
  ///
  /// In ar, this message translates to:
  /// **'يبدأ من'**
  String get startingFrom;

  /// No description provided for @newTag.
  ///
  /// In ar, this message translates to:
  /// **'جديد'**
  String get newTag;

  /// No description provided for @categoryAll.
  ///
  /// In ar, this message translates to:
  /// **'الكل'**
  String get categoryAll;

  /// No description provided for @welcomeTitle.
  ///
  /// In ar, this message translates to:
  /// **'أهلاً وسهلاً'**
  String get welcomeTitle;

  /// No description provided for @welcomeDesc.
  ///
  /// In ar, this message translates to:
  /// **'في مطعم المركزية، نُقدم لك أشهى المأكولات وأفضل الخدمات لتجربة طعام لا تُنسى.'**
  String get welcomeDesc;

  /// No description provided for @backToHome.
  ///
  /// In ar, this message translates to:
  /// **'العودة للرئيسية'**
  String get backToHome;

  /// No description provided for @asSelected.
  ///
  /// In ar, this message translates to:
  /// **'حسب الاختيار'**
  String get asSelected;

  /// No description provided for @bestseller.
  ///
  /// In ar, this message translates to:
  /// **'🔥 الأكثر طلباً'**
  String get bestseller;

  /// No description provided for @noDishesFound.
  ///
  /// In ar, this message translates to:
  /// **'لم يتم العثور على أطباق'**
  String get noDishesFound;

  /// No description provided for @retry.
  ///
  /// In ar, this message translates to:
  /// **'إعادة المحاولة'**
  String get retry;

  /// No description provided for @notificationsTitle.
  ///
  /// In ar, this message translates to:
  /// **'الإشعارات'**
  String get notificationsTitle;

  /// No description provided for @noNotifications.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد إشعارات حالياً'**
  String get noNotifications;

  /// No description provided for @notificationDetails.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل الإشعار'**
  String get notificationDetails;

  /// No description provided for @notificationExpiry.
  ///
  /// In ar, this message translates to:
  /// **'ستنتهي صلاحية هذا التنبيه خلال {days} أيام'**
  String notificationExpiry(int days);

  /// No description provided for @messageContent.
  ///
  /// In ar, this message translates to:
  /// **'محتوى الرسالة:'**
  String get messageContent;

  /// No description provided for @whatsapp.
  ///
  /// In ar, this message translates to:
  /// **'واتساب'**
  String get whatsapp;

  /// No description provided for @support.
  ///
  /// In ar, this message translates to:
  /// **'الدعم'**
  String get support;

  /// No description provided for @unknownCustomer.
  ///
  /// In ar, this message translates to:
  /// **'عميل مجهول'**
  String get unknownCustomer;

  /// No description provided for @connectionError.
  ///
  /// In ar, this message translates to:
  /// **'تعذر الاتصال بالخادم. تأكد من تشغيل الخدمة.'**
  String get connectionError;

  /// No description provided for @orderSendError.
  ///
  /// In ar, this message translates to:
  /// **'تعذر إرسال الطلب'**
  String get orderSendError;

  /// No description provided for @loginFailed.
  ///
  /// In ar, this message translates to:
  /// **'فشل تسجيل الدخول'**
  String get loginFailed;

  /// No description provided for @registerFailed.
  ///
  /// In ar, this message translates to:
  /// **'فشل إنشاء الحساب'**
  String get registerFailed;

  /// No description provided for @reviewFailed.
  ///
  /// In ar, this message translates to:
  /// **'فشل في إرسال التقييم'**
  String get reviewFailed;

  /// No description provided for @prepTime.
  ///
  /// In ar, this message translates to:
  /// **'20 - 30 دقيقة'**
  String get prepTime;

  /// No description provided for @inRoute.
  ///
  /// In ar, this message translates to:
  /// **'في الطريق'**
  String get inRoute;

  /// No description provided for @waitingCancellation.
  ///
  /// In ar, this message translates to:
  /// **'بانتظار الإلغاء'**
  String get waitingCancellation;

  /// No description provided for @cancelOrder.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الطلب'**
  String get cancelOrder;

  /// No description provided for @cancelReasonTitle.
  ///
  /// In ar, this message translates to:
  /// **'لماذا تود إلغاء الطلب؟'**
  String get cancelReasonTitle;

  /// No description provided for @cancelReason1.
  ///
  /// In ar, this message translates to:
  /// **'اخترت صنفاً خاطئاً'**
  String get cancelReason1;

  /// No description provided for @cancelReason2.
  ///
  /// In ar, this message translates to:
  /// **'تأخر المطعم في تجهيز الطلب'**
  String get cancelReason2;

  /// No description provided for @cancelReason3.
  ///
  /// In ar, this message translates to:
  /// **'الأصناف المختارة غير متوفرة'**
  String get cancelReason3;

  /// No description provided for @cancelReason4.
  ///
  /// In ar, this message translates to:
  /// **'أسباب أخرى'**
  String get cancelReason4;

  /// No description provided for @otherReasonNote.
  ///
  /// In ar, this message translates to:
  /// **'طلب الإلغاء قيد المراجعة، سيتواصل معك فريق خدمة العملاء خلال 3-5 دقائق، أو يمكنك الاتصال بهم مباشرةً'**
  String get otherReasonNote;

  /// No description provided for @callSupport.
  ///
  /// In ar, this message translates to:
  /// **'اتصل بخدمة العملاء العامة'**
  String get callSupport;

  /// No description provided for @selectBranch.
  ///
  /// In ar, this message translates to:
  /// **'اختر الفرع *'**
  String get selectBranch;

  /// No description provided for @branchMadina.
  ///
  /// In ar, this message translates to:
  /// **'فرع شارع المدينة'**
  String get branchMadina;

  /// No description provided for @branchKhalda.
  ///
  /// In ar, this message translates to:
  /// **'فرع خلدة'**
  String get branchKhalda;

  /// No description provided for @branchRequired.
  ///
  /// In ar, this message translates to:
  /// **'يرجى اختيار الفرع أولاً'**
  String get branchRequired;

  /// No description provided for @searchPlaceholder.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن طبق أو صنف...'**
  String get searchPlaceholder;

  /// No description provided for @searchResults.
  ///
  /// In ar, this message translates to:
  /// **'نتائج البحث'**
  String get searchResults;

  /// No description provided for @recentSearches.
  ///
  /// In ar, this message translates to:
  /// **'عمليات البحث الأخيرة'**
  String get recentSearches;

  /// No description provided for @noResultsFound.
  ///
  /// In ar, this message translates to:
  /// **'لم يتم العثور على نتائج'**
  String get noResultsFound;

  /// No description provided for @biometricReason.
  ///
  /// In ar, this message translates to:
  /// **'أثبت هويتك للدخول إلى حسابك'**
  String get biometricReason;

  /// No description provided for @biometricEnableReason.
  ///
  /// In ar, this message translates to:
  /// **'أثبت هويتك لتفعيل الدخول بالبصمة'**
  String get biometricEnableReason;

  /// No description provided for @biometricAuthFailed.
  ///
  /// In ar, this message translates to:
  /// **'فشل التحقق من البصمة'**
  String get biometricAuthFailed;

  /// No description provided for @biometricNotAvailable.
  ///
  /// In ar, this message translates to:
  /// **'البصمة غير متوفرة في هذا الجهاز'**
  String get biometricNotAvailable;

  /// No description provided for @loginWithFingerprint.
  ///
  /// In ar, this message translates to:
  /// **'الدخول بالبصمة'**
  String get loginWithFingerprint;

  /// No description provided for @biometricEnabled.
  ///
  /// In ar, this message translates to:
  /// **'تم تفعيل الدخول بالبصمة بنجاح ✅'**
  String get biometricEnabled;

  /// No description provided for @forgotPassword.
  ///
  /// In ar, this message translates to:
  /// **'نسيت كلمة المرور؟'**
  String get forgotPassword;

  /// No description provided for @loginRequired.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الدخول مطلوب'**
  String get loginRequired;

  /// No description provided for @loginToOrderMessage.
  ///
  /// In ar, this message translates to:
  /// **'يرجى تسجيل الدخول لتتمكن من إتمام الطلب ومتابعة حالته.'**
  String get loginToOrderMessage;

  /// No description provided for @minOrderWarningPrefix.
  ///
  /// In ar, this message translates to:
  /// **'الحد الأدنى للطلب لهذه المنطقة هو '**
  String get minOrderWarningPrefix;

  /// No description provided for @minOrderWarningMissing.
  ///
  /// In ar, this message translates to:
  /// **' (ينقصك '**
  String get minOrderWarningMissing;

  /// No description provided for @cartChangedError.
  ///
  /// In ar, this message translates to:
  /// **'تغيرت محتويات السلة! يرجى مراجعة الطلب مرة أخرى.'**
  String get cartChangedError;

  /// No description provided for @priceChangedError.
  ///
  /// In ar, this message translates to:
  /// **'تغيرت الأسعار في السلة! يرجى مراجعة الطلب مرة أخرى.'**
  String get priceChangedError;

  /// No description provided for @minOrderError.
  ///
  /// In ar, this message translates to:
  /// **'لم يتم الوصول للحد الأدنى للطلب'**
  String get minOrderError;

  /// No description provided for @addressAreaLabel.
  ///
  /// In ar, this message translates to:
  /// **'المنطقة'**
  String get addressAreaLabel;

  /// No description provided for @addressStreetLabel.
  ///
  /// In ar, this message translates to:
  /// **'الشارع'**
  String get addressStreetLabel;

  /// No description provided for @addressBuildingLabel.
  ///
  /// In ar, this message translates to:
  /// **'البناية'**
  String get addressBuildingLabel;

  /// No description provided for @otpEmailPrompt.
  ///
  /// In ar, this message translates to:
  /// **'يرجى إدخال الكود المرسل لبريدك الإلكتروني'**
  String get otpEmailPrompt;

  /// No description provided for @laterBtn.
  ///
  /// In ar, this message translates to:
  /// **'لاحقاً'**
  String get laterBtn;

  /// No description provided for @activateBtn.
  ///
  /// In ar, this message translates to:
  /// **'تفعيل'**
  String get activateBtn;

  /// No description provided for @cancelOrderSuccess.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال طلب الإلغاء بنجاح'**
  String get cancelOrderSuccess;

  /// No description provided for @cancelOrderFailed.
  ///
  /// In ar, this message translates to:
  /// **'فشل الإلغاء: '**
  String get cancelOrderFailed;

  /// No description provided for @loginToSeeOrdersMsg.
  ///
  /// In ar, this message translates to:
  /// **'يرجى تسجيل الدخول لعرض الطلبات.'**
  String get loginToSeeOrdersMsg;

  /// No description provided for @fetchOrdersFailedMsg.
  ///
  /// In ar, this message translates to:
  /// **'فشل في جلب الطلبات: '**
  String get fetchOrdersFailedMsg;

  /// No description provided for @cancellationRejected.
  ///
  /// In ar, this message translates to:
  /// **'تم رفض طلب الإلغاء'**
  String get cancellationRejected;

  /// No description provided for @updatedBadge.
  ///
  /// In ar, this message translates to:
  /// **'تم التحديث!'**
  String get updatedBadge;

  /// No description provided for @phoneNumberLabel.
  ///
  /// In ar, this message translates to:
  /// **'رقم الجوال'**
  String get phoneNumberLabel;

  /// No description provided for @invalidPhoneError.
  ///
  /// In ar, this message translates to:
  /// **'يرجى إدخال رقم جوال صحيح'**
  String get invalidPhoneError;

  /// No description provided for @passwordLengthError.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور يجب أن تكون 8 أحرف على الأقل'**
  String get passwordLengthError;

  /// No description provided for @resetPasswordPrompt.
  ///
  /// In ar, this message translates to:
  /// **'أدخل بريدك الإلكتروني وسنرسل لك كود لإعادة تعيين كلمة المرور'**
  String get resetPasswordPrompt;

  /// No description provided for @emailSentMsg.
  ///
  /// In ar, this message translates to:
  /// **'إذا كان البريد مسجلاً، ستصلك رسالة قريباً'**
  String get emailSentMsg;

  /// No description provided for @sendCodeBtn.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الكود'**
  String get sendCodeBtn;

  /// No description provided for @resetPasswordTitle.
  ///
  /// In ar, this message translates to:
  /// **'إعادة تعيين كلمة المرور'**
  String get resetPasswordTitle;

  /// No description provided for @resetPasswordDesc.
  ///
  /// In ar, this message translates to:
  /// **'أدخل الكود المرسل إلى {email} وكلمة المرور الجديدة'**
  String resetPasswordDesc(String email);

  /// No description provided for @otpCodeLengthError.
  ///
  /// In ar, this message translates to:
  /// **'أدخل الكود المكوّن من 6 أرقام'**
  String get otpCodeLengthError;

  /// No description provided for @newPasswordLabel.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور الجديدة'**
  String get newPasswordLabel;

  /// No description provided for @confirmPasswordLabel.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد كلمة المرور'**
  String get confirmPasswordLabel;

  /// No description provided for @passwordsNotMatchError.
  ///
  /// In ar, this message translates to:
  /// **'كلمتا المرور غير متطابقتين'**
  String get passwordsNotMatchError;

  /// No description provided for @passwordResetSuccess.
  ///
  /// In ar, this message translates to:
  /// **'تم تعيين كلمة المرور بنجاح ✅'**
  String get passwordResetSuccess;

  /// No description provided for @resetPasswordAction.
  ///
  /// In ar, this message translates to:
  /// **'تعيين كلمة المرور'**
  String get resetPasswordAction;

  /// No description provided for @verificationCodeTitle.
  ///
  /// In ar, this message translates to:
  /// **'كود التحقق'**
  String get verificationCodeTitle;

  /// No description provided for @biometricDialogTitle.
  ///
  /// In ar, this message translates to:
  /// **'تفعيل الدخول بالبصمة'**
  String get biometricDialogTitle;

  /// No description provided for @biometricDialogDesc.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد تفعيل الدخول بالبصمة لتسريع الوصول إلى حسابك في المستقبل؟'**
  String get biometricDialogDesc;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}

# 📋 خطة معالجة الثغرات والعيوب المعمارية المحدثة — تطبيق المركزية (Al Markazia)

أشكرك جزيل الشكر على هذه **التعديلات الدقيقة والممتازة جداً!** 🎯 ملاحظاتك تعكس فهماً عميقاً لبنية النظام وتفاصيل تدفق الطلبات ونقاط الولاء. لقد قمت بدمج تعديلاتك فوراً في خطة العمل لضمان تطابق كامل مع سلوك الـ Backend وتوفير تجربة مستخدم مثالية.

إليك تفاصيل التحقق الفعلي وخطة الحل المحدثة وفقاً لـ **ترتيب التنفيذ الموصى به**.

---

## 📅 ترتيب التنفيذ التفصيلي والمعتمد

### 🔴 أولاً: الأمن وتأمين البيئة (المدة المقدرة: 5 دقائق)
**الهدف:** إزالة ملفات المفاتيح الحساسة من تتبع Git وتأمينها دون حذفها من القرص مع تدويرها.

1. **إضافة الاستثناءات:**
   إضافة المسار التالي لملف [gitignore](file:///c:/Users/User/Desktop/p4/.gitignore):
   ```
   al_markazia_backend/src/config/keys/
   ```
2. **إزالة المفاتيح من التتبع:**
   تشغيل الأوامر التالية لإزالتها من Git مع الاحتفاظ بها محلياً:
   ```bash
   git rm --cached al_markazia_backend/src/config/keys/private.pem
   git rm --cached al_markazia_backend/src/config/keys/public.pem
   ```
3. **تدوير المفاتيح محلياً:**
   توليد زوج مفاتيح تشفير جديد تماماً لمستقبل الـ JWT:
   ```bash
   cd al_markazia_backend/src/config/keys
   openssl genrsa -out private.pem 2048
   openssl rsa -in private.pem -pubout -out public.pem
   ```

---

### 🟡 ثانياً: شاشة الزوار وتوجيه تسجيل الدخول (المدة المقدرة: ساعة)
**الهدف:** تحسين واجهة المستخدم وجعلها مرنة وتفاعلية عند محاولة الضغط على "تأكيد الطلب" كضيف.

1. **تصميم الـ Bottom Sheet:**
   بناء نافذة منبثقة ممتازة بلغة عربية دافئة تدعو للتسجيل وتشرح له أن سلته محفوظة.
2. **التدفق التلقائي الذكي (Auto-Resume Flow):**
   تعديل دالة `_confirmOrder()` في شاشة [checkout_screen.dart](file:///c:/Users/User/Desktop/p4/al_markazia_app/lib/screens/checkout_screen.dart):
   ```dart
   void _confirmOrder() async {
     final auth = context.read<AuthController>();
     if (!auth.isAuthenticated) {
       _showLoginPrompt(context);
       return;
     }
     // ... إكمال الطلب للعميل المسجل ...
   }
   ```
   عند العودة الناجحة من شاشة `AuthScreen` بعد تسجيل الدخول، يتم استدعاء `_confirmOrder()` تلقائياً لإتمام الطلب فوراً دون جهد إضافي من العميل!

---

### 🟡 ثالثاً: معمارية الفروع الديناميكية وتعديل الـ toJson (المدة المقدرة: ساعتان)
**الهدف:** جلب الفروع بشكل ديناميكي كامل، ودعم حالات الـ Loading والأخطاء، وتعديل الـ JSON ليكون متطابقاً مع السيرفر.

1. **بناء نموذج الفرع وتحديث الـ API:**
   - إنشاء [branch_model.dart](file:///c:/Users/User/Desktop/p4/al_markazia_app/lib/models/branch_model.dart).
   - إضافة دالة `fetchBranches()` في `ApiService`.
2. **تطوير الـ Controller لدعم الحالات المؤقتة (Loading & Error States):**
   إضافة الحالات التالية في `CheckoutController`:
   * `bool isBranchesLoading = true;`
   * `bool hasBranchError = false;`
   * دالة `fetchBranches()` لجلب الفروع ديناميكياً مع إدارة الأخطاء:
     ```dart
     Future<void> fetchBranches() async {
       isBranchesLoading = true;
       hasBranchError = false;
       notifyListeners();
       try {
         branches = await _api.fetchBranches();
         isBranchesLoading = false;
       } catch (e) {
         isBranchesLoading = false;
         hasBranchError = true;
         debugPrint('Error fetching branches: $e');
       }
       notifyListeners();
     }
     ```
3. **تصميم الواجهة (Skeleton Loader & Fallback Error UI):**
   - في [checkout_screen.dart](file:///c:/Users/User/Desktop/p4/al_markazia_app/lib/screens/checkout_screen.dart), عند `isBranchesLoading == true` نعرض **Skeleton Loader** (وهو عبارة عن Shimmer أو مؤشر تحميل دائري مخصص للفروع لثانية حتى لا تظهر الواجهة فارغة).
   - عند `hasBranchError == true` نعرض رسالة خطأ صريحة مثل *"تعذر تحميل الفروع، يرجى المحاولة مجدداً"* مع زر لإعادة المحاولة (Retry Button).
4. **تعديل دقيق لـ `OrderModel.toJson()`:**
   تعديل التابع ليرسل **فقط** الحقول الأساسية التي يحتاجها السيرفر لإنشاء الطلب، وحذف الحقول التلقائية (`orderId`, `orderNumber`, `timestamp`) وحقول المبالغ المحسوبة محلياً:
   ```dart
   Map<String, dynamic> toJson() => {
     'customerName': customerName,
     'customerPhone': customerPhone,
     'orderType': orderType,
     'address': address,
     'notes': notes,
     'cartItems': cartItems.map((e) => e.toJson()).toList(),
     'branchId': branchId, // UUID الحقيقي
     'deliveryZoneId': deliveryZoneId,
     'usePoints': usePoints,
   };
   ```

---

### 🟡 رابعاً: مبدأ "السيرفر مصدر الحقيقة" وتحديث الحسابات (المدة المقدرة: ساعة)
**الهدف:** مطابقة المبالغ الفعلية وتفادي الحساب الثنائي محلياً وتحديث رصيد نقاط المستخدم بنجاح.

1. **معالجة مبالغ السيرفر وعرضها في شاشة النجاح:**
   - السيرفر يقوم بحساب المجموع النهائي ومقدار الخصم الفعلي بدقة تامة.
   - في شاشة النجاح `OrderSuccessScreen` نقرأ مباشرة `sentOrder.discount` لنعرض للعميل **مبلغ الخصم الفعلي** الحقيقي المطبق من السيرفر.
2. **مزامنة رصيد النقاط الفوري والآمن:**
   - لن نعتمد على كاش النقاط المحلي لتقدير ما تم كسبه أو خصمه يدوياً.
   - فور نجاح عملية الشراء وتلقي الاستجابة الناجحة، نقوم بالنداء على الدالة الذكية لـ `AuthController`:
     ```dart
     // في confirmOrder() بالـ CheckoutController عند النجاح:
     await auth.refreshProfile();
     ```
     هذه العملية تتخاطب فوراً مع مسار `/auth/me` لجلب الحالة المالية الدقيقة وتحديث كاش النقاط محلياً لتظهر واجهة العميل متطابقة مع قاعدة البيانات بالكامل وبنسبة 100%!

---

## 📊 جدول ملخص الأولويات والجهد المقدر

| الترتيب | المشكلة والهدف | الخطورة والتأثير | الجهد المقدر | الحالة |
| :--- | :--- | :--- | :--- | :--- |
| 1️⃣ | **تأمين وتدوير مفاتيح `private.pem`** | 🔴 **حرج أمنياً** | 5 دقائق | بانتظار موافقتك |
| 2️⃣ | **شاشة الزوار والـ Auto-Resume** | 🟡 **UX هامة للمبيعات** | ساعة واحدة | بانتظار موافقتك |
| 3️⃣ | **الفروع الديناميكية و `OrderModel.toJson()`** | 🟡 **تكامل وموثوقية معمارية** | ساعتان | بانتظار موافقتك |
| 4️⃣ | **السيرفر مصدر الحقيقة و `refreshProfile`** | 🟡 **اتساق حسابي** | ساعة واحدة | بانتظار موافقتك |

---

> [!IMPORTANT]
> **جميع التعديلات أصبحت مدمجة ومصممة بأعلى جودة معمارية لمنع أي سباقات زمنية أو أخطاء حسابية. بانتظار إشارتك الكريمة للبدء فوراً في إنجاز الخطوة الأولى وتأمين مفتاح التشفير!** 🚀🛡️

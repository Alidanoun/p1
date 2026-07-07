# التقرير الأمني والتقني المتكامل - الجزء الثاني (المراحل 4 إلى 6)
## التكاملات الخارجية، البنية الداخلية التفصيلية للباك اند، والقاموس التشريحي لقاعدة البيانات

---

# المرحلة الرابعة: تحليل قنوات الاتصال الخارجية والربط البرمجي (External Integrations)

يتضمن هذا الفصل دراسة نقاط تواصل النظام مع البيئة الخارجية، والمكتبات المسؤولة عن ذلك، والخطط المنهجية اللازمة للربط مع الأنظمة المؤسسية الكبرى (ERP & CRM Enterprise).

## 1. قنوات الاتصال الحالية ومكتباتها البرمجية (Current Integrations)

### أ. نظام الإشعارات الفورية (Firebase Cloud Messaging - FCM)
* **أين يبدأ وينتهي**: يبدأ الاستدعاء من خدمة الإشعارات [notificationService.js](file:///c:/Users/User/Desktop/p4/al_markazia_backend/src/services/notificationService.js) وينتهي بإرسال الحمولة المخصصة (Payload) عبر خدمة `firebase-admin` إلى خوادم جوجل السحابية لنقلها للهواتف المحمولة.
* **شكل الطلب (Request Payload)**:
  ```json
  {
    "token": "dG9rZW5fZXhhbXBsZV8xMjM...",
    "notification": {
      "title": "طلبك قيد التحضير",
      "body": "بدأ الفرع في تجهيز وجبتك المفضلة الآن"
    },
    "data": {
      "orderId": "4892",
      "targetRoute": "/orders/details"
    }
  }
  ```
* **آلية المصادقة**: تتم باستخدام الحساب الخدمي (Service Account Key) الموثق عبر ملف الـ Credentials بصيغة JSON والمشار إليه بمتغيرات البيئة `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` بملف الإعدادات [.env.example](file:///c:/Users/User/Desktop/p4/al_markazia_backend/.env.example).

### ب. قنوات الاتصال الفوري (WebSockets - Socket.io)
* **أين يبدأ وينتهي**: تبدأ تهيئة القناة بـ [socket.js](file:///c:/Users/User/Desktop/p4/al_markazia_backend/src/socket.js) وتعمل على تشغيل خادم موازٍ للـ HTTP يستمع لاتصالات العملاء والمشرفين ويتبادل معهم تحديثات الطلبات لحظياً.
* **التحقق من الهوية**: يُفحص رمز الـ Access Token المرسل في رأس الاتصال (Handshake query) ومطابقة البصمة لضمان حماية الغرف (Rooms) المعزولة للطلب أو الفرع.

### ج. محرك تتبع السائقين والموقع (Google Maps Flutter API)
* يستخدم تطبيق الجوال الحزم `google_maps_flutter` و `geolocator` لالتقاط إحداثيات السائق وإرسالها بالـ WebSocket للسيرفر الذي يعيد توجيهها فوراً لغرفة الطلب النشطة للعميل لعرض موقعه حياً على الخريطة بـ `live_tracking_screen.dart`.

### د. خدمات الدفع الإلكتروني (Payments)
* يدعم نموذج `Payment` بـ `schema.prisma` الحقل `transactionRef` لحفظ معرّف المعاملات الخارجية. لا توجد مكتبة دمج صريحة (مثل Stripe SDK) مدمجة في الكود؛ ويتم تمرير معطيات الدفع عبر التطبيق وحفظ النتيجة بالنظام نقدياً أو عبر المحفظة بشكل افتراضي.

---

## 2. هيكلة متطلبات الربط مع الأنظمة المؤسسية الكبرى (Enterprise Integrations)
لجعل نظام "المركزية" مؤهلاً للترابط المباشر مع عمالقة البرمجيات المؤسسية، يُقترح التعديل التالي:

### أ. الربط مع Oracle ERP / SAP
* **المطلوب برمجياً**: إضافة ناقل محاسبي دوري (Ledger Sync Worker) يقرأ من جدول `DailyFinancialSnapshot` و `FinancialLedger` كل 24 ساعة، ويقوم بتحويل المعطيات لصيغة XML أو JSON متوافقة مع واجهات (OData / RFC API) الخاصة بـ SAP أو Oracle Financials لترحيل القيود اليومية آلياً.
* **الأمان المطلوب**: مصادقة متبادلة باستخدام شهادات رقمية (mTLS) ومفاتيح وصول منفصلة معزولة.

### ب. الربط مع Salesforce / HubSpot / Zoho CRM
* **المطلوب برمجياً**: إنشاء نظام **Webhooks** متكامل. عند حدوث تغيير بجدول `Lead` أو `Opportunity` (مثل كسب صفقة مبيعات `OpportunityWon`)، يقوم الـ Outbox Service بإطلاق طلب HTTP POST فوري إلى الرابط الخارجي المعين من قبل المشرف بالشركة لنقل بيانات العميل المحتمل مع الحقول المخصصة.

---

# الفصل الخامس: البنية المعمارية للباك اند (Backend Internal Architecture)

يوضح هذا القسم تفاصيل معالجة الطلبات وإدارتها دورياً خلف الكواليس.

## 1. المخطط النصي الكامل لمسار الطلب المالي (Request to DB Commit Flow)

```text
[HTTP Client Request]
       │
       ▼
[Advanced Rate Limiter] ──(Redis Lua Evaluation Check)──► [Blocked if limit exceeded]
       │
       ▼
[Authentication Middleware] ──(Session & Fingerprint Valid?)──► [Rejected 401/403]
       │
       ▼
[Branch Access Middleware] ──(Sets app.current_branch_id in traceContext)
       │
       ▼
[Permission & PIN Guards] ──(Bcrypt PIN verification inside Redis)
       │
       ▼
[Idempotency Guard] ──(Checks Idempotency Key in Redis/DB)──► [Cached response if duplicate]
       │
       ▼
[Controller Layer] (e.g. LeadController.convertLead)
       │
       ▼
[Service Layer] (e.g. LeadService -> OpportunityService)
       │
       ▼
[Contract Gateway] (DTO / Contract & System Control Plane health verify)
       │
       ▼
[Prisma Extension Layer] (Automatic AES-256-GCM encryption of phone/email)
       │
       ▼
[Database Transaction (Prisma $transaction)]
  ├── 1. Execute SQL: SELECT set_config('app.current_branch_id', 'branch_uuid', true)
  ├── 2. Execute SQL: INSERT INTO "Opportunity" ... (PostgreSQL RLS applies here!)
  └── 3. Execute SQL: INSERT INTO "OutboxEvent" ...
       │
       ▼
[Database Commit (Success)]
       │
       ▼
[Outbox Dispatcher] (Dispatches OutboxEvent to socket.io or bullmq queue)
       │
       ▼
[HTTP Response Client (200 OK)]
```

---

## 2. تفصيل وظائف الـ Middlewares
* `requestTracing.js`: يُولد UUID فريد لكل طلب (`requestId`) ويضعه بذاكرة التخزين غير المتزامنة `AsyncLocalStorage` لتسهيل تجميع سجلات خادم التطبيق.
* `advancedRateLimiter.js`: يقوم بتشغيل محدد معدل الطلبات الموزع. يتصل بـ Redis ويشغل سكربت LUA للتحقق من عدد الطلبات خلال دقيقة. يحتوي على نظام Circuit Breaker محلي يمنع تعليق السيرفر في حال تعطل Redis.
* `branchAccessMiddleware.js`: يستخلص معرّف الفرع المطلوب للعملية ويقوم بالتحقق من أحقية المستخدم للوصول إليه، ثم يضع المعرّف في `traceContext` لتقوم قاعدة البيانات بعزل الاستعلام تلقائياً.
* `conflictDetection.js`: يفحص ترويسة الطلبات `if-match` ويقارن رقم النسخة للصفقة المعنية بالتعديل للتأكد من عدم حدوث تضارب بالتعديل.

---

## 3. تفصيل المهام وطوابير الخلفية (Cron & Workers)
* **Outbox Dispatcher (مجدل ناقل العمليات)**: يعمل كل 5 ثوانٍ، يستعلم عن الحركات المعلقة بجدول `OutboxEvent` التي تم كتابتها بالتزامن مع معاملات قاعدة البيانات السابقة، ويرسلها بضمان إلى المستلمين (مثل إطلاق إشعارات بوش للعملاء) ثم يحدث حالتها لـ `DISPATCHED` لضمان عدم حدوث تكرار.

---

# المرحلة السادسة: القاموس الجنائي لقاعدة البيانات (Database Forensic Analysis)

نستعرض هنا تفاصيل الحقول والفهارس والجوانب الهيكلية لأهم 12 جدولاً في نظام قاعدة البيانات.

### 1. جدول المستخدمين (`User`)
* **الوظيفة**: تخزين بيانات الموظفين والمشرفين ومدرائهم.
* **الحقول**:
  * `id` | `Int` | إلزامي | مفتاح أساسي تلقائي.
  * `uuid` | `String` | إلزامي | معرّف فريد للعموم.
  * `email` | `String` | إلزامي | البريد الإلكتروني مشفراً بالـ AES-256-GCM.
  * `emailHash` | `String` | اختياري | فريد | Blind Index للاستعلام بالبريد.
  * `phone` | `String` | اختياري | الهاتف مشفراً بالـ AES-256-GCM.
  * `phoneHash` | `String` | اختياري | فريد | Blind Index للاستعلام بالهاتف.
  * `password` | `String` | إلزامي | كلمة المرور المجزأة (Bcrypt).
  * `role` | `UserRole` (Enum) | إلزامي | دور المستخدم (`ADMIN`, `BRANCH_MANAGER`, `MANAGER`, `STAFF`, `CUSTOMER`).
  * `branchId` | `String` (UUID) | اختياري | معرّف الفرع المرتبط.
  * `pinHash` | `String` | اختياري | رمز الأمان المجزأ للموافقة على العمليات المالية والتعديل.
  * `plainPin` | `String` | اختياري | رمز الأمان بالنص الصريح (فجوة أمنية).
* **العلاقات**: يربطه مفتاح خارجي مع جدول `Branch` بحقل `branchId` كعلاقة اختيارية.
* **الفهارس**:
  * `idx_users_branch_id_role` على الحقول المركبة (`branchId`, `role`) لتسريع البحث عن مدراء الفروع.
  * `idx_users_email` على الحقل `email` لتسريع عمليات المصادقة والتحقق من الهوية.

### 2. جدول الفروع (`Branch`)
* **الوظيفة**: تخزين بيانات المواقع الجغرافية والفروع للمطعم.
* **الحقول**:
  * `id` | `String` (UUID) | إلزامي | مفتاح أساسي تلقائي.
  * `name` | `String` | إلزامي | اسم الفرع (مشفراً بالـ AES-256-GCM).
  * `code` | `String` | إلزامي | فريد | الكود التقني الفريد للفرع (مثل AMMAN-01).
  * `isActive` | `Boolean` | إلزامي | افتراضي `true` لتحديد توفر الفرع.
  * `isDeleted` | `Boolean` | إلزامي | افتراضي `false` للحذف الناعم للفرع.
  * `isEmergencyClosed` | `Boolean` | إلزامي | مؤشر إغلاق الفرع السريع.

### 3. جدول طلبات الشراء (`Order`)
* **الوظيفة**: فواتير المشتريات وحالات تحضير وجبات الطعام.
* **الحقول**:
  * `id` | `Int` | إلزامي | مفتاح أساسي تلقائي.
  * `orderNumber` | `String` | إلزامي | فريد | رقم الفاتورة التسلسلي الترويجي.
  * `branchId` | `String` (UUID) | إلزامي | الفرع المعالج للطلب (مفروض عليه RLS).
  * `customerId` | `Int` | اختياري | العميل المرتبط بالطلب.
  * `status` | `String` | إلزامي | حالة الطلب (`pending`, `preparing`, `ready`, `delivered`).
  * `subtotal` & `total` | `Decimal` (10, 2) | إلزامي | القيم المالية للفاتورة.
  * `version` | `Int` | إلزامي | افتراضي `1` للتحكم التوافقي.
* **الفهارس**: فهرس مركبة `idx_orders_branch_created` على (`branchId`, `createdAt` تنازلياً) لتسريع تحديث الطلبات بلوحة المشرفين.

### 4. جدول العملاء المحتملين للـ CRM (`Lead`)
* **الوظيفة**: تسجيل العملاء الجدد ومراحل تأهيلهم.
* **الحقول**:
  * `id` | `Int` | إلزامي | مفتاح أساسي.
  * `uuid` | `String` | إلزامي | فريد | معرّف الفرع الخارجي.
  * `name` | `String` | إلزامي | اسم العميل المحتمل مشفراً بالكامل.
  * `phoneHash` & `emailHash` | `String` | اختياري | فريد | Blind Index للاستعلام والتحقق من عدم تكرار العميل.
  * `status` | `String` | إلزامي | افتراضي `NEW` (الحالات: `NEW`, `CONTACTED`, `QUALIFIED`, `LOST`).
  * `branchId` | `String` (UUID) | إلزامي | الفرع المالك للسجل (مفروض عليه RLS).
  * `customFields` | `Json` | اختياري | الحقول الديناميكية المدخلة للعميل.

### 5. جدول صفقات المبيعات (`Opportunity`)
* **الوظيفة**: الصفقات الملحقة بالعملاء المحتملين وتتبع قيمتها.
* **الحقول**:
  * `id` | `Int` | إلزامي | مفتاح أساسي.
  * `title` | `String` | إلزامي | مسمى الصفقة المبيعية.
  * `value` | `Decimal` (10, 2) | إلزامي | القيمة المالية المتوقعة للصفقة.
  * `stage` | `String` | إلزامي | افتراضي `NEW` (`NEW`, `QUALIFIED`, `PROPOSAL`, `NEGOTIATION`, `WON`, `LOST`).
  * `leadId` | `Int` | اختياري | معرّف العميل المحتمل المرتبط.
  * `customerId` | `Int` | اختياري | معرّف العميل المسجل المرتبط.
  * `branchId` | `String` | إلزامي | الفرع المالك (RLS).
  * `version` | `Int` | إلزامي | رقم نسخة الصفقة.

### 6. جدول الأنشطة البيعية لـ CRM (`SalesActivity`)
* **الوظيفة**: تدوين تاريخ مكالمات واجتماعات الموظفين مع العملاء.
* **الحقول**:
  * `id` | `Int` | إلزامي | مفتاح أساسي.
  * `type` | `String` | إلزامي | نوع النشاط (`CALL`, `EMAIL`, `MEETING`, `WHATSAPP`).
  * `notes` | `String` | اختياري | تفاصيل الملاحظات المدونة.
  * `leadId` & `customerId` & `opportunityId` | `Int` | اختياري | الكيانات المرتبطة بالنشاط.
  * `branchId` | `String` | إلزامي | الفرع المالك للنشاط (RLS).

### 7. جدول الحقول المخصصة لـ CRM (`CustomFieldDefinition`)
* **الوظيفة**: تعريف الحقول الإضافية التي يرغب الأدمن بإضافتها للفرع.
* **الحقول**:
  * `id` | `Int` | إلزامي | مفتاح أساسي.
  * `entityType` | `String` | إلزامي | نوع الكيان (`LEAD` أو `OPPORTUNITY`).
  * `key` | `String` | إلزامي | الكود التقني الفريد للفرع (مثل max_budget).
  * `label` | `String` | إلزامي | المسمى العربي المعروض بالواجهة.
  * `fieldType` | `String` | إلزامي | نوع البيانات المدخلة (`TEXT`, `NUMBER`, `DATE`, `SELECT`, `BOOLEAN`).
  * `options` | `Json` | اختياري | مصفوفة الخيارات في حال كان نوع الحقل هو SELECT.
  * `branchId` | `String` | اختياري | معرّف الفرع المرتبط (القيمة NULL تعني أن الحقل عام لكل الفروع).
* **الفهارس**: فهرس فريد مركب على (`entityType`, `key`, `branchId`) لمنع إنشاء نفس الحقل مرتين بنفس الفرع.

### 8. جدول المراجعات والتقييمات (`Review`)
* **الوظيفة**: تخزين تعليقات الزبائن حول الوجبات والفروع.
* **الحقول**:
  * `id` | `Int` | مفتاح أساسي.
  * `itemId` | `Int` | إلزامي | الوجبة المعنية بالتقييم.
  * `rating` | `Int` | إلزامي | درجة التقييم (من 1 إلى 5).
  * `comment` | `String` (500) | اختياري | التعليق النصي المدخل.
  * `status` | `ModerationStatus` (Enum) | افتراضي `PENDING` (APPROVED, REJECTED, FLAGGED).
  * `fingerprint` | `String` | اختياري | بصمة جهاز الزبون للحد من الاحتيال.

### 9. جدول دفتر الأستاذ المالي (`FinancialLedger`)
* **الوظيفة**: الحركات المالية والقيود المحاسبية للعملاء والفروع.
* **الحقول**:
  * `id` | `Int` | مفتاح أساسي.
  * `branchId` | `String` | إلزامي | الفرع المرتبط بالحركة المالية.
  * `type` | `String` | إلزامي | نوع الحركة (`DEBIT` أو `CREDIT`).
  * `category` | `String` | إلزامي | تصنيف المعاملة (`ORDER_PAYMENT`, `REFUND`, `WALLET_CREDIT`, `ADJUSTMENT`).
  * `amount` | `Decimal` (10, 2) | القيمة المالية للحركة.
  * `balanceBefore` & `balanceAfter` | `Decimal` (10, 2) | حالة رصيد المحفظة قبل وبعد إتمام القيد.

### 10. جدول الاعتمادات المالية والموافقات (`FinancialApproval`)
* **الوظيفة**: تعليق العمليات المالية عالية الخطورة لانتظار موافقة المدير.
* **الحقول**:
  * `id` | `String` (UUID) | مفتاح أساسي.
  * `operationType` | `String` | نوع الحركة المطلوبة (`REFUND`, `PRICE_OVERRIDE`, `CANCELLATION`).
  * `payload` | `Json` | تفاصيل البيانات والطلب المراد تعديله.
  * `status` | `FinancialApprovalStatus` (Enum) | افتراضي `PENDING` (APPROVED, REJECTED, EXPIRED).
  * `riskLevel` | `String` | مستوى خطورة العملية المكتشفة (`HIGH`, `MEDIUM`, `LOW`).

### 11. جدول الرموز السرية للجلسات (`RefreshToken`)
* **الوظيفة**: الحفاظ على جلسات عمل العملاء والمشرفين بالخلفية.
* **الحقول**:
  * `id` | `String` (UUID) | مفتاح أساسي.
  * `token` | `String` | فريد | رمز التجديد المشفر والمحفوظ.
  * `userId` | `String` | إلزامي | معرّف المستخدم (UUID الخاص بـ User أو Customer كعلاقة متعددة الأشكال).
  * `isRevoked` | `Boolean` | افتراضي `false` لإبطال الجلسة أمنياً.

### 12. جدول المهام المعلقة بالـ Outbox (`OutboxEvent`)
* **الوظيفة**: تدوين الأحداث البرمجية الصادرة من قاعدة البيانات للتسليم المضمون.
* **الحقول**:
  * `id` | `String` (UUID) | مفتاح أساسي.
  * `type` | `String` | نوع الحدث المنطلق (مثل `OrderCreated`).
  * `payload` | `Json` | معطيات الحدث المبعوث.
  * `status` | `String` | افتراضي `PENDING` (PENDING, DISPATCHED, FAILED).
  * `createdAt` | `DateTime` | وقت تدوين المعاملة.

# 🚀 Al-Markazia Backend (Enterprise Grade)

![NodeJS](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)
![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)
![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?style=for-the-badge&logo=redis&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/postgresql-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)

نظام إدارة الطلبات والمبيعات المركزي المتقدم (Al-Markazia) مصمم لدعم العمليات التشغيلية المعقدة للشركات عبر فروع متعددة مع التركيز على **الموثوقية (Reliability)**، **التزامن (Concurrency)**، و**الحماية (Security)**.

---

## 🌟 الميزات الهندسية المتقدمة (Core Features)

### 1. آلة الحالة المتقدمة للطلبات (Order State Machine)
لا يتم تغيير حالات الطلبات بشكل عشوائي، بل تخضع لـ **Strict State Machine**:
* **Enforced Transitions**: منع الانتقالات غير المنطقية (مثال: لا يمكن للطلب الانتقال من `pending` إلى `delivered` مباشرة).
* **Role-Based Guards**: بعض الحالات يمكن للسائق فقط نقلها، والبعض الآخر لمدير الفرع.
* **Audit Trail**: كل تغيير حالة يُسجل تلقائياً مع تفاصيل الموظف، الفرع، والسبب.

### 2. معالجة التزامن العالي (Concurrency & Idempotency)
لحماية النظام من الأخطاء عند ضغط العمل أو انقطاع شبكة الإنترنت:
* **Optimistic Locking**: استخدام `version` مع كل طلب لمنع موظفين اثنين من تعديل نفس الطلب في نفس اللحظة (Race Conditions).
* **Redis-Backed Idempotency Guard**: كل عملية تعديل حيوية (Status, Payment, Cancel) تمتلك `Idempotency-Key` لضمان تنفيذ العملية مرة واحدة فقط، حتى لو قام العميل بالنقر عدة مرات بسبب بطء الشبكة.

### 3. بنية متعددة الفروع (Multi-Tenant Branch Architecture)
* عزل كامل لبيانات الفروع.
* **Zero-Trust Branch Middleware**: لا نثق بالفرع المرسل من واجهة المستخدم، بل يتم التحقق من الصلاحيات والفرع المعين للموظف من الـ Token والـ Database لضمان عدم اختراق فرع آخر.

### 4. أمان عالي وسلامة النظام (Resilience & Security)
* **Zod Contracts**: فحص صارم للمدخلات في الـ Gateway لمنع أي بيانات خبيثة من الوصول إلى قاعدة البيانات.
* **Circuit Breakers**: النظام محمي من فشل الخدمات الخارجية (إشعارات، بوابات دفع).
* **Health Monitoring**: نظام مراقبة مستمر يعلق عمليات معينة إذا كان هناك ضغط على الخادم لحماية الخدمة من التوقف.

---

## 🏗️ البنية المعمارية (Architecture Overview)

```mermaid
graph TD
    Client[Web/Mobile Client] -->|HTTPS + JWT + Idempotency Key| Nginx[Nginx Proxy]
    Nginx --> API[Express.js API Gateway]
    
    subgraph "Application Core"
        API --> AuthMW[Security & Auth Middleware]
        AuthMW --> Gateway[Contract Gateway]
        Gateway --> Validation[Zod Schema Validation]
        Validation --> StateMachine[Order State Machine]
        StateMachine --> Orchestrator[Lifecycle Orchestrator]
    end

    subgraph "Infrastructure Layer"
        Orchestrator --> Redis[(Redis Cache & Locks)]
        Orchestrator --> Prisma[Prisma ORM]
        Prisma --> DB[(PostgreSQL)]
    end

    classDef core fill:#2c3e50,stroke:#34495e,stroke-width:2px,color:#fff;
    classDef infra fill:#2980b9,stroke:#3498db,stroke-width:2px,color:#fff;
    class API,AuthMW,Gateway,Validation,StateMachine,Orchestrator core;
    class Redis,Prisma,DB infra;
```

---

## 🛠️ كيف يعمل النظام من الداخل؟ (The Request Flow)

عندما يقوم مدير بتغيير حالة الطلب من `pending` إلى `ready`:

1. **Idempotency Check**: يفحص Redis ما إذا كان هذا الطلب (عبر `Idempotency-Key`) قيد المعالجة أو تمت معالجته للتو لمنع تكرار العملية.
2. **Branch Access Validation**: يتأكد النظام أن المدير ينتمي للفرع الخاص بالطلب ولن يسمح بتعديل طلبات فروع أخرى.
3. **Gateway Contract Enforcement**: يتم فحص هيكل الطلب (`version` + `status`) باستخدام `Zod.strict()`.
4. **State Machine Verification**: التحقق مما إذا كان الانتقال من `pending` إلى `ready` مسموحاً في قانون العمل.
5. **Atomic Database Transaction**: يتم التحديث مع زيادة الـ `version` لحماية النظام من التداخل.
6. **Background Tasks**: يتم إطلاق الأحداث (Events) لإرسال إشعارات للعميل وإغلاق الـ Redis Lock.

---

## 🚀 التشغيل (Deployment)

النظام يعمل عبر Docker للبيئة الإنتاجية مما يوفر سهولة في التوسع:

```bash
# بناء وتشغيل الحاويات (Database, Redis, API, Proxy)
docker-compose -f docker-compose.yml up -d --build

# مراقبة أداء الخادم
docker logs -f al-markazia-prod-app
```

## 🔒 الممارسات الأمنية (Security Practices)
- **Rate Limiting**: لحماية واجهات الـ API من هجمات الـ DDoS.
- **Fingerprinting Guard**: رصد تغيير الجهاز لتجنب سرقة الجلسات.
- **No-Eviction Redis Policy**: ضمان عدم فقدان مفاتيح الـ Idempotency.

# مطعم المركزية - AL-MARKAZIA

تم بناء هيكل هذا التطبيق يدوياً باستخدام **Flutter Native** بناءً على طلبك.

## تعليمات التشغيل والمتابعة:

1. **تثبيت Flutter:**
   - قم بزيارة [موقع Flutter الرسمي](https://docs.flutter.dev/get-started/install/windows) وحمل الـ SDK.
   - قم بفك ضغطه ووضعه في مسار مثل `C:\src\flutter`.
   - أضف المسار `C:\src\flutter\bin` إلى متغيرات البيئة (Environment Variables) في الويندوز.

2. **فتح المشروع:**
   - افتح برنامج Android Studio.
   - اختر "Open" وحدد المجلد `c:\Users\User\Desktop\p4\al_markazia_app`.

3. **تثبيت الحزم (Dependencies):**
   - في سطر الأوامر الخاص بـ Android Studio (Terminal)، تأكد أنك داخل مجلد التطبيق، واكتب:
     ```bash
     flutter pub get
     ```

4. **تشغيل الخادم المحلي للمنيو الديمو (json-server):**
   - افتح موجه أوامر آخر (Command Prompt) وانتقل إلى مجلد الخلفية:
     ```bash
     cd c:\Users\User\Desktop\p4\backend
     ```
   - قم بتثبيت `json-server` عالمياً (إذا لم يكن مثبتاً): `npm install -g json-server`
   - شغل السيرفر:
     ```bash
     npx json-server --watch db.json --port 3000 --host 0.0.0.0
     ```

5. **تشغيل التطبيق:**
   - من داخل Android Studio، اختر جهاز الـ Emulator.
   - اضغط على زر Run (▶️) أو نفذ الأمر:
     ```bash
     flutter run
     ```
   - (التطبيق مضبوط للاتصال بـ `http://10.0.2.2:3000` الذي يقابل localhost على الكمبيوتر بالنسبة لـ Android Emulator).

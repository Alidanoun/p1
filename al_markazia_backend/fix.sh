sed -i "s/const sameSite = isProd ? 'strict' : 'lax';/const sameSite = isProd ? 'none' : 'lax';/g" ~/al_markazia_backend/src/controllers/authController.js

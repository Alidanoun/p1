@echo off
set FILTER_BRANCH_SQUELCH_WARNING=1
git filter-branch --force --index-filter "git rm -r --cached --ignore-unmatch al_markazia_backend/src/config/keys/private.pem al_markazia_backend/src/config/keys/public.pem al_markazia_app/android/app/google-services.json al_markazia_backend/uploads/ al_markazia_app/android/.kotlin/errors/" --prune-empty --tag-name-filter cat -- --all

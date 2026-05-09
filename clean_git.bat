@echo off
set FILTER_BRANCH_SQUELCH_WARNING=1
git filter-branch --force --index-filter "git rm --cached --ignore-unmatch al_markazia_backend/src/config/keys/private.pem al_markazia_backend/src/config/keys/public.pem" --prune-empty --tag-name-filter cat -- --all

#!/bin/bash
curl -s -X POST https://al-markazia.duckdns.org/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@almarkazia.com","password":"Almarkazia123@"}'

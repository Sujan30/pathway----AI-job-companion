#!/usr/bin/env bash
# Starts the CRM server + UI. Run from agents-hack/.
set -e

echo "Starting CRM server on :8000..."
(cd server && uvicorn main:app --host 0.0.0.0 --port 8000 --reload) &
SERVER_PID=$!

echo "Starting CRM UI on :3000..."
(cd crm && npm run dev) &
UI_PID=$!

echo ""
echo "  API:  http://localhost:8000/api/health"
echo "  CRM:  http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $SERVER_PID $UI_PID 2>/dev/null" EXIT
wait

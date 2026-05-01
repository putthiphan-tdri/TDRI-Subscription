#!/bin/zsh

cd "$(dirname "$0")" || exit 1

BASE_PORT=5177
PORT=$BASE_PORT

while /usr/sbin/lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://127.0.0.1:${PORT}/"

clear
echo "TDRI Big Data Subscription App"
echo
echo "Folder:"
echo "$(pwd)"
echo
echo "Opening:"
echo "$URL"
echo
echo "Keep this Terminal window open while you use the subscription app."
echo "Close this window when you are finished."
echo

open "$URL"
python3 -m http.server "$PORT" --bind 127.0.0.1

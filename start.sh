#!/bin/bash
while true; do
  PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/server.js
  echo "Server crashed, restarting in 2s..."
  sleep 2
done

#!/usr/bin/env python3
"""Run an offline, localhost-only browser preview of GS SunoShimmerFree.

Standard library only. This serves the files on your own computer.
No audio is uploaded. Close this terminal or press Ctrl+C to stop.
"""
import os
import pathlib
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765

class LocalOnlyHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

def main():
    os.chdir(ROOT)
    try:
        server = ThreadingHTTPServer((HOST, PORT), LocalOnlyHandler)
    except OSError as exc:
        print("Cannot start preview at http://%s:%s: %s" % (HOST, PORT, exc), file=sys.stderr)
        print("Close any other preview server and retry.", file=sys.stderr)
        return 1
    url = "http://%s:%s/" % (HOST, PORT)
    print("GS SunoShimmerFree preview, local to this computer.")
    print("Open: %s" % url)
    print("Your song files are processed in your browser, not uploaded.")
    print("Press Ctrl+C here to shut down.")
    threading.Timer(0.4, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nPreview stopped.")
    finally:
        server.server_close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

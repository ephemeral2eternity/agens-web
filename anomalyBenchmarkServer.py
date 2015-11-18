#!/usr/bin/python
# Cache Agent in Agent based management and control system
# Chen Wang, chenw@cmu.edu
#!/bin/env python
import sys
import os
import urlparse
from time import sleep

try:
    # Python 2.x
    from SocketServer import ThreadingMixIn
    from SimpleHTTPServer import SimpleHTTPRequestHandler
    from BaseHTTPServer import HTTPServer
except ImportError:
    # Python 3.x
    from socketserver import ThreadingMixIn
    from http.server import SimpleHTTPRequestHandler, HTTPServer

class ThreadingSimpleServer(ThreadingMixIn, HTTPServer):
	pass

class RequestHandler(SimpleHTTPRequestHandler):
	def do_GET(self):
		try:
			if "ico" in self.command:
				return
			elif self.path.startswith('/cpu'):
				# default: just send the file
				url = self.path
				params = url.split('?')[1]
				print params
				cpu_stress_params = urlparse.parse_qs(params)
				print cpu_stress_params
				cpu_stress_workers = cpu_stress_params['N'][0]
				cpu_stress_period = cpu_stress_params['T'][0]

				#note that this potentially makes every file on your computer readable by the internet
				self.send_response(200)
				self.end_headers()
				HTMLcode = '<div><CPU stressing starts with ' + str(cpu_stress_workers) + ' workers running sqrt() for ' + str(cpu_stress_period) + ' seconds!</div>'
				# serve the HTML code to client on Google App Engine Python using webapp2
				self.wfile.write(HTMLcode)
				return

		except IOError as e :  
			# debug     
			print e
			self.send_error(404,'File Not Found: %s' % self.path)

#==========================================================================================
# Main Function of Cache Agent
#==========================================================================================
def main(argv):
	if sys.argv[1:]:
	    port = int(sys.argv[1])
	else:
	    port = 80

	if sys.argv[2:]:
	    os.chdir(sys.argv[2])

	server = ThreadingSimpleServer(('', port), RequestHandler)
	try:
	    while 1:
	        sys.stdout.flush()
	        server.handle_request()
	except KeyboardInterrupt:
	    print("Finished")

if __name__ == '__main__':
    main(sys.argv)
 


"use strict";

var experiment = false;

function Performance() {

	var self = this;
	self.health = 0;
	self.bandwidthUsage = 0;
	self.performance = 0;
}

function Status() {

	var self = this;
	self.connected = false;
	self.streaming = false;
	self.findingParent = false;
	self.reconnecting = false;
}

function WRTCConnection(_config) {

	var self = this;

	// ID of the other peer.
	self.id = _config.id;
	self.otherPeer = _config.other;
	self.signalingChannel = _config.signalingChannel;
	self.dataChannel;
	self.stream;
	self.isbackup = false;
	self.depth = 0;
	
	// Is sender or receiver
	self.mode = "sender";

	self.config = { "iceServers": [{ "url": "stun:stun.1.google.com:19302" }] }; 
	self.connection = new RTCPeerConnection(self.config);

	// EXPERIMENTATION
	self.data = [];
	self.end_exp = false;

	self.getOther = function(){
		return self.otherPeer;
	}

	self.getStream = function(){
		return self.stream;
	}

	self.connection.onicecandidate = function (evt) {
		
		if (evt.candidate){
    		self.signalingChannel.emit('signal', { desc: 'forward', forwardType: "onicecandidate", from: self.id, to: self.otherPeer, message: evt.candidate });
		}	
	}

	self.connection.oniceconnectionstatechange = function(event) {
	  if (self.connection.iceConnectionState === "failed" || self.connection.iceConnectionState === "disconnected" || self.connection.iceConnectionState === "closed") {
	  	console.log(self.connection.iceConnectionState)
	  }
	};

	self.sendOffer = function(){

		self.connection.createOffer()
        .then( function (offer) {
            return self.connection.setLocalDescription(offer);
        })
        .then( function() {
            console.log("Sending Offer")
            let forward_type = "offer";
            self.signalingChannel.emit('signal', { desc: 'forward', forwardType: forward_type, from: self.id, to: self.otherPeer, message: self.connection.localDescription });
        })
        .catch(logError);
	}

    self.connection.onnegotiationneeded = () => {
    	self.sendOffer();
    }

	self.connection.ontrack = function (evt) {
        self.stream = evt.streams[0];
    };

    self.connection.onaddstream = function (evt) {
    	self.mode = "receiver";
        self.stream = evt.stream;
    };

    // EXPERIMENT

    self.startStats = function(){
    	self.data = [{id: self.id, type: "receiver", sender: self.otherPeer, depth: self.depth}];
    	getStats(self.connection, self.logStats, 1000);
    }

    self.logStats = function(stats){

    	if (!self.end_exp){
	    	self.data.push(stats.results[9]);
    	}
    }

    self.start_logs = function(){
    	getStats(self.connection, self.logStats, 1000);
    }

    self.end_logs = function (){
    	console.log("ENDING EXPERIEMENT")

    	var avgObject = {};
    	// Find the Average

    	var jitter = 0;
    	var interframe = 0;
    	var width = 0;
    	var height = 0;
    	var frameRate = 0;
    	var currDelay = 0;

    	for (var i = 0; i < self.data.length; i++){
    		jitter += parseFloat(self.data[i].googJitterBufferMs);
	    	interframe += parseFloat(self.data[i].googInterframeDelayMax);
	    	width += parseFloat(self.data[i].googFrameWidthReceived);
	    	height += parseFloat(self.data[i].googFrameHeightReceived);
	    	frameRate += parseFloat(self.data[i].googFrameRateReceived);
	    	currDelay += parseFloat(self.data[i].googCurrentDelayMs);
    	}

    	var total = self.data.length;
    	var output = {
    		jitter : (jitter / total).toFixed(2),
    		interframe : (interframe / total).toFixed(2),
    		width : (width / total).toFixed(2),
    		height : (height / total).toFixed(2),
    		frameRate : (frameRate / total).toFixed(2),
    		currDelay : (currDelay / total).toFixed(2)
    	};

		let info_signal = { desc: "information", type: "logs", from : self.id, to: "server", data: output }
		self.signalingChannel.emit('signal', info_signal);    	
		self.end_exp = true;

		// Close Window.
		//setTimeout(function(){ window.close(); }, 2000);
    }
}

function Peer(config) {
	
	var self = this;
	self.broadcaster = config.broadcaster;
	self.MAX_CONNECTIONS = 5;
	self.performance = new Performance();

	// States
	self.streaming = false;
	self.livestream = true;
	
	/*
		This is an object containing all the webRTC connections including:
		1. My parent who is sending me the stream.
		2. My backup connections, who may or may not send me a stream.
	*/

	self.connections = {};

	/*
		Backup Modes
		1. Open a WebRTC Connection with MediaStream with a Backup.
		DEFAULT. Store Backup Peer Locally: Do not open a connection, until required. 
	*/

	self.backup_mode = 'DEFAULT';

	// Socket Channel and Socket ID
	self.signalingChannel = io();
	self.id;

	self.stream;
	self.aspectRatio = { width: 1920, height: 1080 };	// 1080p
	self.streamAttached = false;
	self.viewView;
	


	/*
		Once the a new peer connects to the server. It has two options depnding on its status:
		If its a broadcaster:
			it tells the server that its a broadcaster
		Else if its not a broadcaster, or is a viewer client
			it sends a message to the moderator saying that I would like to connect.
			the moderator is responsible for telling the client who should he connect to.
	*/

	self.signalingChannel.on('connect', function (socket) {
	    
	    self.id = self.signalingChannel.id;

	    var sig = {};
		if (self.broadcaster){
			// Tell the server that I am a broadcaster
			sig = { desc: "broadcaster", from : self.id, to: "server", message: "I am the broadcaster." };
		} else {
			// Connection Request to the broadcaster
			sig = { desc: "moderator", from : self.id, to : "server", message: "I would like to connect." };
		}
		
		var date = new Date();
		self.startTime = date.getTime();
		self.signalingChannel.emit('signal', sig);
	});

	/*
		The createConnection is responsible for creating a new WebRTC connection with
		a client who's socket ID is fed to the function. 
		The broadcaster inits a connection with the new client.
	*/

	self.createConnection = function(otherID) {

		var config = { id: self.id, other: otherID, signalingChannel: self.signalingChannel }
		var conn = new WRTCConnection(config);
		self.connections[otherID] = conn;

		// The addStream function triggers the new WebRTC connection setup between the two clients.
		if (self.broadcaster || self.stream)
			self.connections[otherID].connection.addStream(self.stream.clone());
	}

	/*
		Initializing a Backup Connection: 

		Backup Modes: 
		1. Open a WebRTC Connection with MediaStream with a Backup.
		DEFAULT. Store Backup Peer Locally: Do not open a connection, until required. 
	*/

	self.createBackupConnection = function(backups) {

		for (var i = 0; i < backups.length; i++){
			
			let otherID = backups[i];

			// Create a new Connection.
			let config = { id: self.id, other: otherID, signalingChannel: self.signalingChannel }
			let conn = new WRTCConnection(config);
			self.connections[otherID] = conn;

			// Mark it as a backup.
			self.connections[otherID].isbackup = true;

			switch (self.backup_mode) {
				case 1:

					//1. Open a WebRTC Connection containing a MediaStream with the Backup.
					self.signalingChannel.emit('signal', { desc: 'forward', forwardType: "backuprequest", from: self.id, to: otherID });
					break;
				
				default:
					// By DEFAULT Store Backup Peer Locally: Do not open a connection, until required. 
					break;
			}
		}
	}

	self.parentdied = function(parentID){

		self.streamAttached = false
		delete self.connections[parentID];

		switch (self.backup_mode) {
			
			case 1:

				// 1. Connect to another stream.
				for (var conn in self.connections) {
			    	if (self.connections.hasOwnProperty(conn)) {
			        	self.stream = self.connections[conn].getStream();
				        self.viewStream("videoView");
						self.streaming = true;
			        	console.log("Stream set to:", conn);
			        	return conn;
			        }
			    }
				
				break;
	
			default:

				// 2. Store Backup Peer Locally: Do not open a connection, until required. 
				self.streaming = false;
				for (var conn in self.connections) {
			    	if (self.connections.hasOwnProperty(conn)) {
			    		self.signalingChannel.emit('signal', { desc: 'forward', forwardType: "backuprequest", from: self.id, to: self.connections[conn].id });
			        	return conn;
			        }
			    }
				break;
		}
	}

	/*
		This function is responsible in fetching the user's media and storing the stream locally
		 (If the user is a broadcaster), otherwise it just displays the stream to the users DOM.
	*/

	self.createStream = function(width, height, dom_ele) {

		self.aspectRatio = { width: width, height: height };
		self.viewView = dom_ele;

		var recordedVideo = document.getElementById('recorded');

		if (self.broadcaster) {

			if (self.livestream){
				
				var getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
				var constraints = { video: self.aspectRatio, audio: false };
				
				if (getUserMedia) {
				    
				    getUserMedia = getUserMedia.bind(navigator);
					getUserMedia(constraints, 
					    
					    (stream) => {
					    	self.stream = stream.clone();
							self.viewStream(dom_ele);
					    }, 
					    (error) => {
					    	
					    }
					)			
				}

			} else {

				if (recordedVideo.captureStream) {
					self.stream = recordedVideo.captureStream();
					self.viewStream(dom_ele);
			    	console.log(self.stream)
			    } 
			}

		} 
				
	}

	self.viewStream = function(dom_ele){
		
		self.viewView = dom_ele;
		if (!self.streamAttached){
			var video = document.getElementById(dom_ele);
			video.setAttribute('height', self.aspectRatio.height + '');
			video.setAttribute('width', self.aspectRatio.width + '');
			var objectURL = window.URL || window.webkitURL;

		    try {
			  video.srcObject = self.stream;
			} catch (error) {
			  video.src = URL.createObjectURL(mediaSource);
			}

		    video.play(); 
		    self.streamAttached = true;

		    // EXPERIMENT
		    if (experiment){
			    var date = new Date();
			    let info_signal = { desc: "information", type: "start_time", from : self.id, to: "server", data: date.getTime() - self.startTime}
				self.signalingChannel.emit('signal', info_signal);  
			    setTimeout(function(){ window.open ("http://localhost:3000/",self.id); }, 2000);
			}
		}
	}


	self.signalingChannel.on('signal', function(in_signal)  {
		
	    var signal = in_signal;

	    if (signal.desc) {
	        
	        var desc = signal.desc;

	        switch (desc) {
	        	
	        	case "broadcaster":
	        		// Message for the broadcaster
	        		console.log(signal.message)
	        		break;

	        	case "request":

	        		// Request from a client to connect.
	        		console.log(signal.from, " would like to connect.");
	        		// Set up a new WebRTC connection.
                    self.createConnection(signal.from);
	        		break;

	        	case "backups":

	        		// Receiving your backup connections from the server.
	        		console.log("My backups are: ", signal.backups);
	        		self.createBackupConnection(signal.backups);

	        		break;

	        	case "backuprequest":

	        		// Some one wants you to be there backup.
	        		console.log(signal.from, " sent a backup request.");
	        		self.createConnection(signal.from);
	        		break;

	        	case "offer":
					
					// Set up a new WebRTC connection.
					self.createConnection(signal.from);

					// Sending Answer.
					self.connections[signal.from].connection.setRemoteDescription(signal.message).then(function () {
		            	console.log("Creating Answer")
		                return self.connections[signal.from].connection.createAnswer();
		            }).then((answer) => {
		                return self.connections[signal.from].connection.setLocalDescription(answer);
		            }).then(() => {
		            	console.log("Sending Answer")
		                self.signalingChannel.emit('signal', { desc: "forward", forwardType: "answer", to: signal.from, from: self.id, message: self.connections[signal.from].connection.localDescription });
		            }).catch(logError);	        		
		            
		            break;
	        	
	        	case "answer":
	        		
	        		console.log("Receiving Answer")
		            self.connections[signal.from].connection.setRemoteDescription(signal.message).catch(logError);
	        		break;

	        	case "onicecandidate":

	        		console.log("On Ice Connection")
	        		self.connections[signal.from].connection.addIceCandidate(signal.message).catch(logError);
	        		
	        	case "connected":
	        		
		        	console.log("Connection established with:", self.connections[signal.from].getOther());
		        	console.log("My Connections: ", self.connections);

		        	if (!self.streaming && self.connections[signal.from].getStream()){
		        		self.stream = self.connections[signal.from].getStream();
		        		self.viewStream("videoView");
						self.streaming = true;

						self.connectedTO = signal.from;

						// Signaling my connected status.
						let info_signal = { desc: "information", type: "connected", from : self.id, with: self.connections[signal.from].getOther(), to: "server" }
						self.signalingChannel.emit('signal', info_signal);

						// HTML content for DEBUG
						document.getElementById("myid").innerHTML = self.id;
						document.getElementById("connectedto").innerHTML = self.connections[signal.from].getOther();
		        	}

		        	if (self.connections[signal.from].isbackup){
		        		
		        		self.connections[signal.from].isbackup = false;
		        		let info_signal = { desc: "information", type: "newbackup", from : self.id, backup: self.connections[signal.from].getOther(), to: "server" }
						self.signalingChannel.emit('signal', info_signal);
		        	}

	        		break;	

	        	case "parentdied":
	        		
	        		// Signal received when your parent dies.
	        		console.log(signal.from, " is dead.");

	        		// Connect to a new parent
	        		let newParent = self.parentdied(signal.from);

	        		// Inform the server about the new parent.
	        		let info_signal = { desc: "information", type: "newparent", from : self.id, parent: newParent, to: "server" }
					self.signalingChannel.emit('signal', info_signal);

	        		break;
	        	
	        	case "childdied":

	        		break;

	        	case "backupdied":

	        		break;

	        	case "error":
	        		console.log("Error: ", signal.desc.message);
	        		break;

	        	case "start_logs":
	        		
	        		// EXPERIMENT
	        		// Time: 60000 * n (mins)

	        		console.log("STARTING EXPERIMENT")
	        		self.connections[self.connectedTO].start_logs();
	        		setTimeout(self.connections[self.connectedTO].end_logs, 6000);
	        		break;

	        	case "show_log":

	        		document.getElementById("data").innerHTML = JSON.stringify(signal.data);
	        		break;

	        	case "close":
	        		setTimeout(function(){ window.close(); }, 200);
	        		break;

	        	default:
	            	
	            	console.warn("Unsupported SDP type: ", signal.desc);
	        		break;
	        }

	    } else {
	    	console.log("adding IceCandidate")
	        self.connections[peerID].addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(logError);
	    }
	});
}

function logError(error) {
    console.log(error.name + ": " + error.message);
}


document.addEventListener('DOMContentLoaded', main);

function main(){

	//var recordedVideo = document.getElementById('recorded');
	//recordedVideo.style.display = "none";

	var peer;
	var isbroadcaster = false;

	if (window.location.hash == "#broadcaster"){
		isbroadcaster = true;
	} 

	peer = new Peer({broadcaster : isbroadcaster});
	peer.createStream(1920, 1080, "videoView");

}



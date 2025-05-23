import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../utils/AppContext';

function PianobarPage() {
  // Get state from context
  const { pianobar, actions } = useAppContext();
  
  // Component state
  const [selectedStation, setSelectedStation] = useState('');
  const [showOperationMessage, setShowOperationMessage] = useState(false);
  const [operationMessage, setOperationMessage] = useState('');
  const [buttonLocked, setButtonLocked] = useState(false);
  const [buttonAction, setButtonAction] = useState(null); // 'starting' or 'stopping'
  
  // WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const [currentSong, setCurrentSong] = useState({
    title: '',
    artist: '',
    album: '',
    stationName: '',
    songDuration: 0,
    rating: 0
  });
  const wsRef = useRef(null);
  
  // Update selected station when pianobar status changes
  useEffect(() => {
    if (pianobar.status && pianobar.status.stationId) {
      setSelectedStation(pianobar.status.stationId);
    }
  }, [pianobar.status]);
  
  // Check pianobar status when component mounts
  useEffect(() => {
    // Initial status check
    actions.refreshPianobar();
  }, []);
  
  // Setup WebSocket connection for real-time updates
  useEffect(() => {
    // Create WebSocket connection
    const websocket = new WebSocket(`ws://${window.location.hostname}:3001/api/pianobar/ws`);
    
    websocket.onopen = () => {
      console.log('Pianobar WebSocket connected');
      setWsConnected(true);
    };
    
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received:', data);
      
      if (data.type === 'status') {
        console.log('Status update received:', data.data);
        // Update player status
        actions.updatePianobarStatus({
          isRunning: true,
          isPlaying: data.data.status === 'playing',
          status: {
            ...pianobar.status,
            status: data.data.status
          }
        });
      } else if (data.type === 'event') {
        console.log(`Event received: ${data.data.eventType}`, data.data);
        
        if (data.data.eventType === 'songstart') {
          console.log('SONG START EVENT with data:', {
            title: data.data.title,
            artist: data.data.artist,
            album: data.data.album,
            stationName: data.data.stationName,
            songDuration: data.data.songDuration,
            rating: data.data.rating
          });
          
          // Update current song info
          setCurrentSong({
            title: data.data.title || '',
            artist: data.data.artist || '',
            album: data.data.album || '',
            stationName: data.data.stationName || '',
            songDuration: parseInt(data.data.songDuration) || 0,
            rating: data.data.rating || 0
          });
          
          // Also update in global state for consistency
          actions.updatePianobarStatus({
            status: {
              ...pianobar.status,
              song: data.data.title,
              artist: data.data.artist,
              album: data.data.album,
              station: data.data.stationName
            }
          });
        } else if (data.data.eventType === 'usergetstations' && data.data.stations) {
          console.log('STATIONS LIST RECEIVED:', data.data.stations);
          // Update station list dynamically
          const stationList = parseStationList(data.data.stations);
          if (stationList && stationList.length > 0) {
            console.log('Parsed station list:', stationList);
            actions.updatePianobarStations(stationList.map(station => station.name));
          }
        } else if (data.data.eventType === 'songlove') {
          console.log('SONG LOVE EVENT received');
          setCurrentSong(prev => ({...prev, rating: 1}));
        } else if (data.data.eventType === 'songfinish') {
          console.log('SONG FINISH EVENT received');
        } else if (data.data.eventType === 'stationchange') {
          console.log('STATION CHANGE EVENT received:', data.data.stationName);
        }
      }
    };
    
    websocket.onclose = () => {
      console.log('Pianobar WebSocket disconnected');
      setWsConnected(false);
    };
    
    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    wsRef.current = websocket;
    
    return () => {
      websocket.close();
    };
  }, []);
  
  // Helper function to parse station list
  const parseStationList = (stationsData) => {
    if (Array.isArray(stationsData)) {
      return stationsData.map((station, index) => ({
        id: station.id || index.toString(),
        name: station.name || `Station ${index}`
      }));
    }
    
    if (typeof stationsData === 'string') {
      // Parse the station list from pianobar format
      // Expected format: "0) Station Name\n1) Another Station\n..."
      const lines = stationsData.split('\n').filter(line => line.trim());
      return lines.map(line => {
        const match = line.match(/^(\d+)\)\s+(.+)$/);
        if (match) {
          return { id: match[1], name: match[2] };
        }
        return null;
      }).filter(Boolean);
    }
    
    return [];
  };
  
  // Helper to check if player is on
  const isPlayerOn = () => {
    const result = pianobar.isRunning;
    // Only log during button operations to reduce console noise
    if (buttonLocked || showOperationMessage) {
      console.log('isPlayerOn() check during operation:', {
        'pianobar.isRunning': pianobar.isRunning,
        'pianobar.status': pianobar.status,
        'buttonLocked': buttonLocked,
        'result': result
      });
    }
    return result;
  };
  
  // Helper to check if player is playing
  const isPlaying = () => {
    return isPlayerOn() && pianobar.isPlaying;
  };
  
  // Start the player
  const handleStartPlayer = async () => {
    // Prevent rapid clicking
    if (buttonLocked || showOperationMessage) {
      console.log('⚠️ Button locked or operation in progress, ignoring click');
      return;
    }

    console.log('🟢 handleStartPlayer called - STARTING pianobar');
    console.log('Player state before start:', {
      'pianobar.isRunning': pianobar.isRunning,
      'isPlayerOn()': isPlayerOn()
    });
    
    setButtonLocked(true);
    setButtonAction('starting');
    showOperation('Starting Pandora player...');
    
    try {
      const result = await actions.controlPianobar('start');
      if (result) {
        console.log('Pianobar started successfully');
      } else {
        console.error('Failed to start pianobar');
      }
      
      // Wait a moment before refreshing to avoid race conditions
      await new Promise(resolve => setTimeout(resolve, 1000));
      await actions.refreshPianobar();
    } catch (error) {
      console.error('Error starting player:', error);
    } finally {
      hideOperation();
      setTimeout(() => {
        setButtonLocked(false);
        setButtonAction(null);
      }, 2000); // Keep locked for 2 more seconds
    }
  };
  
  // Stop the player
  const handleStopPlayer = async () => {
    // Prevent rapid clicking
    if (buttonLocked || showOperationMessage) {
      console.log('⚠️ Button locked or operation in progress, ignoring click');
      return;
    }

    console.log('🔴 handleStopPlayer called - STOPPING pianobar');
    console.log('Player state before stop:', {
      'pianobar.isRunning': pianobar.isRunning,
      'isPlayerOn()': isPlayerOn()
    });
    
    setButtonLocked(true);
    setButtonAction('stopping');
    showOperation('Stopping Pandora player...');
    
    try {
      const result = await actions.controlPianobar('stop');
      if (result) {
        console.log('Pianobar stopped successfully');
      } else {
        console.error('Failed to stop pianobar');
      }
      
      // Wait a moment before refreshing to avoid race conditions
      await new Promise(resolve => setTimeout(resolve, 1000));
      await actions.refreshPianobar();
    } catch (error) {
      console.error('Error stopping player:', error);
    } finally {
      hideOperation();
      setTimeout(() => {
        setButtonLocked(false);
        setButtonAction(null);
      }, 2000); // Keep locked for 2 more seconds
    }
  };
  
  // Send control command
  const handleCommand = async (command) => {
    if (!isPlayerOn()) return;
    
    try {
      await actions.controlPianobar('command', { command });
      
      // Refresh pianobar status after command
      await actions.refreshPianobar();
    } catch (error) {
      console.error(`Error sending command ${command}:`, error);
    }
  };
  
  // Change station
  const handleChangeStation = async () => {
    if (!selectedStation || !isPlayerOn()) return;
    
    showOperation('Changing station...');
    
    try {
      // Always use the REST API for commands
      const result = await actions.controlPianobar('selectStation', { stationId: selectedStation });
      console.log('Sent select-station command via REST API');
      
      if (result) {
        console.log('Station changed successfully');
      } else {
        console.error('Failed to change station');
      }
    } catch (error) {
      console.error('Error changing station:', error);
    } finally {
      hideOperation();
    }
  };
  
  // Play/pause
  const handlePlayPause = async () => {
    if (!isPlayerOn()) return;
    
    try {
      if (isPlaying()) {
        // Always use the REST API for commands
        await actions.controlPianobar('pause');
        console.log('Sent pause command via REST API');
      } else {
        await actions.controlPianobar('play');
        console.log('Sent play command via REST API');
      }
    } catch (error) {
      console.error('Error toggling playback:', error);
    }
  };
  
  // Skip to next song
  const handleNext = async () => {
    if (!isPlayerOn()) return;
    
    try {
      // Always use the REST API for commands
      await actions.controlPianobar('next');
      console.log('Sent next command via REST API');
    } catch (error) {
      console.error('Error skipping song:', error);
    }
  };
  
  // Love current song
  const handleLove = async () => {
    if (!isPlayerOn()) return;
    
    try {
      // Always use the REST API for commands
      await actions.controlPianobar('love');
      console.log('Sent love command via REST API');
      
      // We don't need to update local state immediately anymore
      // WebSocket will send a songlove event that will update the UI
    } catch (error) {
      console.error('Error loving song:', error);
    }
  };
  
  // Get current song info
  const getSongInfo = () => {
    if (!pianobar.status) {
      return { song: 'Not Playing', artist: '', album: '', station: '' };
    }
    
    return {
      song: pianobar.status.song || 'Not Playing',
      artist: pianobar.status.artist || '',
      album: pianobar.status.album || '',
      station: pianobar.status.station || '',
    };
  };
  
  // Helper to show operation message
  const showOperation = (message) => {
    setOperationMessage(message);
    setShowOperationMessage(true);
  };
  
  // Helper to hide operation message
  const hideOperation = () => {
    setShowOperationMessage(false);
  };
  
  const { song, artist, album, station } = getSongInfo();

  return (
    <div className="container mx-auto p-4 relative">
      {/* WebSocket connection indicator */}
      <div className="absolute top-4 right-4 flex items-center">
        <div 
          className={`w-3 h-3 rounded-full mr-2 ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} 
          title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'} 
        />
        <span className="text-xs text-gray-500">
          {wsConnected ? 'Live updates' : 'Polling updates'}
        </span>
      </div>
      
      <h1 className="text-3xl font-bold mb-6">Pandora Music Player</h1>
      
      {/* Error Display */}
      {pianobar.error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <p className="font-bold">Error</p>
          <p>{pianobar.error}</p>
        </div>
      )}
      
      {/* Loading Indicator */}
      {pianobar.loading && (
        <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded mb-4">
          Loading player status...
        </div>
      )}
      
      {/* Operation Message */}
      {showOperationMessage && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4">
          {operationMessage}
        </div>
      )}
      
      {/* Music Player Controls */}
      <div className="bg-white p-6 rounded shadow">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">
            Player Status: {isPlayerOn() ? (isPlaying() ? 'Playing' : 'Paused') : 'Off'}
          </h2>
          {(() => {
            const playerOn = isPlayerOn();
            console.log('🎛️ Button render decision:', {
              'isPlayerOn()': playerOn,
              'showing': playerOn ? 'Turn Off button' : 'Turn On button',
              'handler': playerOn ? 'handleStopPlayer' : 'handleStartPlayer'
            });
            
            // Determine button text based on current action or state
            const getButtonText = () => {
              if (buttonAction === 'starting') return 'Starting...';
              if (buttonAction === 'stopping') return 'Stopping...';
              if (buttonLocked) return buttonAction ? `${buttonAction}...` : 'Processing...';
              const text = playerOn ? 'Turn Off' : 'Turn On';
              
              console.log('🎯 Button text decision:', {
                'buttonAction': buttonAction,
                'buttonLocked': buttonLocked,
                'playerOn': playerOn,
                'finalText': buttonAction ? `${buttonAction}...` : text
              });
              
              return text;
            };
            
            // Determine which handler to use (based on current state when clicked)
            const getClickHandler = () => {
              return playerOn ? handleStopPlayer : handleStartPlayer;
            };
            
            // Determine button color
            const getButtonColor = () => {
              if (buttonLocked || pianobar.loading || showOperationMessage) {
                return 'bg-gray-400 cursor-not-allowed';
              }
              return playerOn ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600';
            };
            
            return (
              <button 
                onClick={getClickHandler()}
                className={`px-4 py-2 rounded text-white ${getButtonColor()}`}
                disabled={buttonLocked || pianobar.loading || showOperationMessage}
              >
                {getButtonText()}
              </button>
            );
          })()}
        </div>
        
        {/* Song Info (Hidden when player is off) */}
        <div className={isPlayerOn() ? '' : 'opacity-50'}>
          <div className="mb-4">
            <p className="text-lg font-semibold">Now Playing</p>
            {/* Prefer WebSocket data when available, fallback to API data */}
            <p className="text-xl font-bold" data-testid="song-title">
              {currentSong.title || song || 'No song playing'}
            </p>
            {(currentSong.artist || artist) && (
              <p data-testid="song-artist">{currentSong.artist || artist}</p>
            )}
            {(currentSong.album || album) && (
              <p className="text-sm text-gray-600" data-testid="song-album">
                Album: {currentSong.album || album}
              </p>
            )}
            {(currentSong.stationName || station) && (
              <p className="text-sm text-gray-600" data-testid="song-station">
                Station: {currentSong.stationName || station}
              </p>
            )}
            {currentSong.rating > 0 && (
              <p className="text-sm text-red-500 flex items-center mt-1">
                <span className="mr-1">Loved</span> <span className="text-red-500">❤️</span>
              </p>
            )}
          </div>
          
          {/* Playback Controls */}
          <div className="flex space-x-4 my-4">
            <button 
              onClick={handleLove}
              className={`p-2 rounded-full ${
                !isPlayerOn() 
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : currentSong.rating > 0 
                    ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse' 
                    : 'bg-red-500 hover:bg-red-600 text-white'
              }`}
              disabled={!isPlayerOn()}
              title={currentSong.rating > 0 ? "Loved Song" : "Love This Song"}
            >
              ❤️
            </button>
            <button 
              onClick={handlePlayPause}
              className={`p-2 rounded-full ${
                isPlayerOn() 
                  ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
              disabled={!isPlayerOn()}
              title={isPlaying() ? 'Pause' : 'Play'}
            >
              {isPlaying() ? '⏸️' : '▶️'}
            </button>
            <button 
              onClick={handleNext}
              className={`p-2 rounded-full ${
                isPlayerOn() 
                  ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
              disabled={!isPlayerOn()}
              title="Next Song"
            >
              ⏭️
            </button>
            <button 
              onClick={() => actions.refreshPianobar()}
              className="p-2 bg-gray-200 hover:bg-gray-300 rounded-full"
              title="Refresh Status"
            >
              🔄
            </button>
          </div>
          
          {/* Station Selector */}
          <div className="mt-6">
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium">Select Station</label>
              {(!isPlayerOn() || !Array.isArray(pianobar.stations) || pianobar.stations.length === 0) && (
                <span className="text-xs text-amber-600">
                  {isPlayerOn() ? 'Waiting for stations...' : 'Turn on player to see your stations'}
                </span>
              )}
            </div>
            <div className="flex space-x-2">
              <select 
                className={`block w-full p-2 border rounded ${!isPlayerOn() ? 'bg-gray-100' : ''}`}
                value={selectedStation}
                onChange={(e) => setSelectedStation(e.target.value)}
                disabled={!isPlayerOn() || pianobar.loading || !Array.isArray(pianobar.stations) || pianobar.stations.length === 0}
              >
                <option value="">Select a station...</option>
                {Array.isArray(pianobar.stations) && pianobar.stations.map((station, index) => (
                  <option key={index} value={index}>{station}</option>
                ))}
              </select>
              <button
                onClick={handleChangeStation}
                className={`px-4 py-2 rounded ${
                  isPlayerOn() && selectedStation 
                    ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
                disabled={!isPlayerOn() || !selectedStation}
              >
                Change
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Usage Instructions */}
      <div className="mt-6 bg-gray-50 p-4 rounded border">
        <h3 className="font-semibold mb-2">How to Use:</h3>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Turn on the music player using the "Turn On" button</li>
          <li>Use the playback controls to skip songs or pause music</li>
          <li>Heart a song to tell Pandora you like it</li>
          <li>Change stations using the selector</li>
          <li>Turn off the player when done</li>
        </ol>
      </div>
    </div>
  );
}

export default PianobarPage;
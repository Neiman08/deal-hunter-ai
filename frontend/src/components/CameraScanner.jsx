import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { X, Camera, AlertTriangle } from 'lucide-react';

/**
 * CameraScanner — live camera barcode/QR reader via @zxing/browser.
 * Calls onDetected(code) on first successful scan, then stops.
 * Stops all MediaStream tracks on close/unmount.
 */
export default function CameraScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const hasDetectedRef = useRef(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');

  function stopCamera() {
    try {
      readerRef.current?.reset();
    } catch {}
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }

  async function startScanner(deviceId) {
    setError('');
    setScanning(true);
    hasDetectedRef.current = false;
    stopCamera();

    try {
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      const constraints = deviceId
        ? { video: { deviceId: { exact: deviceId } } }
        : { video: { facingMode: 'environment' } };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      reader.decodeFromStream(stream, videoRef.current, (result, err) => {
        if (result && !hasDetectedRef.current) {
          hasDetectedRef.current = true;
          const code = result.getText();
          stopCamera();
          setScanning(false);
          onDetected(code);
        }
      });
    } catch (err) {
      setScanning(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Camera permission denied. Please allow camera access in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        setError('No camera found on this device.');
      } else {
        setError(`Camera error: ${err.message}`);
      }
    }
  }

  useEffect(() => {
    BrowserMultiFormatReader.listVideoInputDevices()
      .then(devs => {
        setDevices(devs);
        const backCamera = devs.find(d => /back|rear|environment/i.test(d.label));
        const first = backCamera || devs[0];
        if (first) {
          setSelectedDevice(first.deviceId);
          startScanner(first.deviceId);
        } else {
          startScanner('');
        }
      })
      .catch(() => startScanner(''));

    return () => stopCamera();
  }, []);

  function handleClose() {
    stopCamera();
    onClose();
  }

  function switchCamera(deviceId) {
    setSelectedDevice(deviceId);
    startScanner(deviceId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden" style={{ background: '#0a0a12', border: '1px solid #273449' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Camera size={16} className="text-neon-green" /> Scan Barcode / QR
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Video */}
        <div className="relative bg-black" style={{ aspectRatio: '4/3' }}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
            autoPlay
          />
          {/* Scan reticle */}
          {scanning && !error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-56 h-40 border-2 border-neon-green rounded-lg opacity-70" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)' }} />
              <div className="absolute bottom-6 text-neon-green text-xs font-medium animate-pulse">
                Point at barcode
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <AlertTriangle size={32} className="text-yellow-400" />
              <p className="text-white text-sm">{error}</p>
              <button onClick={() => startScanner(selectedDevice)} className="btn-primary text-xs px-4 py-2">
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Camera selector */}
        {devices.length > 1 && (
          <div className="px-4 py-2 border-t border-dark-700">
            <select
              value={selectedDevice}
              onChange={e => switchCamera(e.target.value)}
              className="w-full text-xs rounded-lg px-3 py-1.5"
              style={{ background: '#1E293B', border: '1px solid #334155', color: 'white' }}
            >
              {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 6)}`}</option>
              ))}
            </select>
          </div>
        )}

        <div className="px-4 py-3 text-center">
          <p className="text-xs" style={{ color: '#94A3B8' }}>Scanning automatically · tap outside to close</p>
        </div>
      </div>
    </div>
  );
}

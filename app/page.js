'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import Script from 'next/script';

// 初期設定
const DEFAULT_THRESHOLD = 0.22; // EAR（目の開き）の基準
const HISTORY_SIZE = 10;        // スムージング用

export default function FocusModeApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  // 状態:'LOADING' | 'FOCUSED' | 'SLEEPING' | 'NO_FACE'
  const [status, setStatus] = useState('LOADING'); 
  const [showCamera, setShowCamera] = useState(false);
  const [currentEar, setCurrentEar] = useState(0);

  // カメラ表示状態を同期するためのRef（バグ修正用）
  const showCameraRef = useRef(false);
  
  // 設定値
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const thresholdRef = useRef(DEFAULT_THRESHOLD);

  const earHistory = useRef([]);

  // showCameraの変更をRefに即座に反映
  useEffect(() => {
    showCameraRef.current = showCamera;
  }, [showCamera]);

  // --- 計算ロジック ---
  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  // 目の開き具合 (EAR) の計算
  const calculateEAR = (landmarks) => {
    const getEyeEAR = (p1, p2, p3, p4, p5, p6) => {
      const v1 = getDistance(landmarks[p2], landmarks[p6]);
      const v2 = getDistance(landmarks[p3], landmarks[p5]);
      const h = getDistance(landmarks[p1], landmarks[p4]);
      return (v1 + v2) / (2.0 * h);
    };
    const leftEAR = getEyeEAR(33, 160, 158, 133, 153, 144);
    const rightEAR = getEyeEAR(362, 385, 387, 263, 373, 380);
    return (leftEAR + rightEAR) / 2.0;
  };

  // 判定処理
  const processFrame = useCallback((landmarks) => {
    const rawEAR = calculateEAR(landmarks);

    // EARのスムージング（移動平均）
    earHistory.current.push(rawEAR);
    if (earHistory.current.length > HISTORY_SIZE) earHistory.current.shift();
    const smoothEAR = earHistory.current.reduce((a, b) => a + b, 0) / earHistory.current.length;
    
    setCurrentEar(smoothEAR);

    // ★ 判定ロジック（シンプル版） ★
    if (smoothEAR < thresholdRef.current) {
        setStatus('SLEEPING');
    } else {
        setStatus('FOCUSED');
    }
  }, []);

  const handleThresholdChange = (e) => {
    const newVal = parseFloat(e.target.value);
    setThreshold(newVal);          
    thresholdRef.current = newVal; 
  };

  const startProcessing = async () => {
    if (!window.FaceMesh || !window.Camera) return;

    const faceMesh = new window.FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults((results) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      
      // カメラ映像の描画（Refを使って最新状態を確認）
      if (canvas && video && showCameraRef.current) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
          
          if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
              const landmarks = results.multiFaceLandmarks[0];
              
              // 目の点のみ描画
              ctx.fillStyle = '#00FF00';
              [33, 133, 362, 263].forEach(id => {
                  const p = landmarks[id];
                  if(p) { ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, 2, 0, 2 * Math.PI); ctx.fill(); }
              });
          }
          ctx.restore();
      }

      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        processFrame(results.multiFaceLandmarks[0]);
      } else {
        setStatus('NO_FACE');
        earHistory.current = [];
      }
    });

    if (videoRef.current) {
      const camera = new window.Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) await faceMesh.send({ image: videoRef.current });
        },
        width: 640,
        height: 480,
      });
      camera.start();
    }
  };

  const getStatusColor = () => {
    switch (status) {
        case 'FOCUSED': return 'bg-green-50 border-green-200';
        case 'SLEEPING': return 'bg-red-50 border-red-200';
        case 'NO_FACE': return 'bg-gray-100 border-gray-300';
        default: return 'bg-white';
    }
  };

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center transition-colors duration-500 ${getStatusColor()}`}>
      
      <Script src="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js" strategy="afterInteractive" />
      <Script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" strategy="afterInteractive" onLoad={startProcessing} />

      <div className="relative w-full max-w-2xl aspect-video flex flex-col items-center justify-center p-4">
        
        {/* カメラ映像 */}
        <div className={`absolute inset-0 rounded-2xl overflow-hidden transition-opacity duration-300 ${showCamera ? 'opacity-100 z-10 border-4 border-gray-400' : 'opacity-0 z-0'}`}>
            <video ref={videoRef} className="hidden" playsInline muted />
            <canvas ref={canvasRef} className="w-full h-full object-cover scale-x-[-1]" />
        </div>

        {/* 状態表示UI */}
        <div className={`absolute inset-0 flex flex-col items-center justify-center z-20 transition-opacity duration-300 ${showCamera ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            
            {status === 'LOADING' ? (
                <div className="text-gray-400 animate-pulse">システム準備中...</div>
            ) : (
                <div className="relative flex items-center justify-center">
                    <div className={`absolute w-64 h-64 rounded-full blur-3xl transition-colors duration-500 
                        ${status === 'FOCUSED' ? 'bg-green-200' : 
                          status === 'SLEEPING' ? 'bg-red-200' : 'bg-gray-300'}`}>
                    </div>
                    
                    <div className={`w-56 h-56 rounded-full flex flex-col items-center justify-center shadow-xl border-4 bg-white transition-all duration-500
                        ${status === 'FOCUSED' ? 'border-green-400 scale-100' : 
                          status === 'SLEEPING' ? 'border-red-500 scale-110' : 'border-gray-400 scale-95'}`}>
                        
                        <div className="text-6xl mb-2">
                            {status === 'FOCUSED' && '👀'}
                            {status === 'SLEEPING' && '💤'}
                            {status === 'NO_FACE' && '👻'}
                        </div>
                        
                        <div className={`text-2xl font-bold 
                            ${status === 'FOCUSED' ? 'text-green-600' : 
                              status === 'SLEEPING' ? 'text-red-500' : 'text-gray-500'}`}>
                            {status === 'FOCUSED' && '集中'}
                            {status === 'SLEEPING' && '非集中'}
                            {status === 'NO_FACE' && '顔なし'}
                        </div>
                        
                        <div className="text-[10px] text-gray-400 mt-2 font-mono flex flex-col items-center">
                           <span>EAR: {currentEar.toFixed(3)}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
      </div>

      <div className="fixed bottom-8 flex flex-col gap-4 bg-white/90 backdrop-blur px-6 py-4 rounded-2xl shadow-lg border border-gray-200 z-50 w-80">
          <div className="flex flex-col gap-2">
              <div className="flex justify-between text-xs text-gray-500 font-bold">
                  <span>反応しにくい</span>
                  <span>閾値: {threshold.toFixed(2)}</span>
                  <span>厳しい</span>
              </div>
              <input type="range" min="0.15" max="0.30" step="0.01" value={threshold} onChange={handleThresholdChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-500" />
              <div className="text-[10px] text-gray-400 text-center">右にするほど、少し目を細めただけで「居眠り」になります</div>
          </div>
          <div className="w-full h-px bg-gray-200"></div>
          <button onClick={() => setShowCamera(!showCamera)} className="flex items-center justify-center gap-2 text-sm text-gray-700 hover:text-black font-medium">
            {showCamera ? '映像を隠す' : '映像で目を確認'}
          </button>
      </div>
    </div>
  );
}
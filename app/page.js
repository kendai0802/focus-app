'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import Script from 'next/script';

// ★ 設定: 何ミリ秒よそ見したら「非集中」にするか（5秒 = 5000）
const TIME_TO_TRIGGER_SLEEP = 5000;
const HISTORY_SIZE = 10;
const DEFAULT_THRESHOLD = 0.22;

export default function FocusModeApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [status, setStatus] = useState('LOADING'); 
  const [showCamera, setShowCamera] = useState(false);
  const [currentEar, setCurrentEar] = useState(0);
  
  // ★ パネルの開閉状態管理
  const [isSettingsOpen, setIsSettingsOpen] = useState(true);

  // ★ 5秒カウント用: よそ見を開始した時刻を記録
  const outOfFocusStartTimeRef = useRef(null);

  const showCameraRef = useRef(false);
  
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const thresholdRef = useRef(DEFAULT_THRESHOLD);

  const earHistory = useRef([]);

  useEffect(() => {
    showCameraRef.current = showCamera;
  }, [showCamera]);

  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

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

  const processFrame = useCallback((landmarks) => {
    const rawEAR = calculateEAR(landmarks);

    earHistory.current.push(rawEAR);
    if (earHistory.current.length > HISTORY_SIZE) earHistory.current.shift();
    const smoothEAR = earHistory.current.reduce((a, b) => a + b, 0) / earHistory.current.length;
    
    setCurrentEar(smoothEAR);

    // ★ 判定ロジック（5秒ルール適用） ★
    if (smoothEAR < thresholdRef.current) {
        if (outOfFocusStartTimeRef.current === null) {
            outOfFocusStartTimeRef.current = Date.now();
        } else {
            const elapsed = Date.now() - outOfFocusStartTimeRef.current;
            if (elapsed > TIME_TO_TRIGGER_SLEEP) {
                setStatus('SLEEPING');
            }
        }
    } else {
        outOfFocusStartTimeRef.current = null;
        setStatus('FOCUSED');
    }
  }, []);

  const handleThresholdChange = (e) => {
    const newVal = parseFloat(e.target.value);
    setThreshold(newVal);          
    thresholdRef.current = newVal; 
  };

  // ★ 自動キャリブレーション機能 ★
  const calibrateThreshold = () => {
    if (currentEar > 0) {
        const recommended = Math.max(0.15, currentEar - 0.04); 
        setThreshold(recommended);
        thresholdRef.current = recommended;
        alert(`現在の目の開き(${currentEar.toFixed(3)})に合わせて\n閾値を ${recommended.toFixed(3)} に設定しました！`);
    }
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
      
      if (canvas && video && showCameraRef.current) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
          
          if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
              const landmarks = results.multiFaceLandmarks[0];
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
        outOfFocusStartTimeRef.current = null;
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
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* コントロールパネルの表示切り替え */}
      {isSettingsOpen ? (
        /* 開いている時 */
        <div className="fixed bottom-8 flex flex-col gap-4 bg-white/95 backdrop-blur px-6 py-6 rounded-2xl shadow-xl border border-gray-200 z-50 w-96 animate-in slide-in-from-bottom-5 fade-in duration-300">
            
            {/* ★ 閉じるボタン (×) */}
            <button 
                onClick={() => setIsSettingsOpen(false)}
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
                aria-label="閉じる"
            >
                ✕
            </button>

            {/* ★ 視覚ゲージ */}
            <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden relative mt-2">
                <div className="absolute top-0 bottom-0 w-1 bg-red-500 z-10 shadow-[0_0_8px_rgba(239,68,68,0.8)]" style={{ left: `${(threshold / 0.4) * 100}%` }}></div>
                <div className={`absolute top-0 bottom-0 left-0 transition-all duration-300 ${currentEar < threshold ? 'bg-red-300' : 'bg-green-500'}`} style={{ width: `${(currentEar / 0.4) * 100}%` }}></div>
            </div>
            <div className="flex justify-between text-[10px] text-gray-500 font-mono">
               <span>閉 (0.0)</span>
               <span>現在: {currentEar.toFixed(3)}</span>
               <span>開 (0.4)</span>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center text-xs text-gray-500 font-bold">
                    <span>閾値: {threshold.toFixed(2)}</span>
                    <button 
                      onClick={calibrateThreshold}
                      className="px-3 py-1.5 bg-blue-500 text-white rounded-md text-xs hover:bg-blue-600 transition-colors shadow-sm font-bold"
                    >
                      今の目で自動設定
                    </button>
                </div>
                <input type="range" min="0.10" max="0.35" step="0.01" value={threshold} onChange={handleThresholdChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-500" />
                <div className="text-[10px] text-gray-400 text-center leading-tight">
                    赤い線より緑のバーが左に行き、<br/>5秒経過すると「非集中」になります。
                </div>
            </div>
            
            <div className="w-full h-px bg-gray-200 my-1"></div>
            <button onClick={() => setShowCamera(!showCamera)} className="flex items-center justify-center gap-2 text-sm text-gray-700 hover:text-black font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors">
              {showCamera ? '📷 映像を隠す' : '📷 映像で目を確認'}
            </button>
        </div>
      ) : (
        /* 閉じている時：設定を開くボタン */
        <button 
            onClick={() => setIsSettingsOpen(true)}
            className="fixed bottom-8 bg-white/90 backdrop-blur px-6 py-3 rounded-full shadow-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-50 hover:scale-105 transition-all z-50 flex items-center gap-2"
        >
            ⚙ 設定
        </button>
      )}
    </div>
  );
}
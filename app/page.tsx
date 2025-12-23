'use client';

import React, { useRef, useState, useCallback } from 'react';
import Script from 'next/script';

export default function FocusModeApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  // 状態管理
  const [isLoaded, setIsLoaded] = useState(false);
  const [showCamera, setShowCamera] = useState(false); // デフォルトでカメラ映像を隠す
  const [score, setScore] = useState(100);
  const [isFocused, setIsFocused] = useState(true);

  // 履歴バッファ（スムージング用）
  const historyRef = useRef([]);
  const HISTORY_SIZE = 10;

  // --- 計算ロジック (変更なし) ---
  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  const calculateData = (landmarks) => {
    // 1. EAR (目の開き具合)
    const leftEyeH = getDistance(landmarks[33], landmarks[133]);
    const leftEyeV = (getDistance(landmarks[160], landmarks[144]) + getDistance(landmarks[158], landmarks[153])) / 2;
    const leftEAR = leftEyeV / leftEyeH;
    const rightEyeH = getDistance(landmarks[362], landmarks[263]);
    const rightEyeV = (getDistance(landmarks[385], landmarks[380]) + getDistance(landmarks[387], landmarks[373])) / 2;
    const rightEAR = rightEyeV / rightEyeH; 
    const ear = (leftEAR + rightEAR) / 2;

    // 2. 姿勢
    const leftFace = landmarks[234];
    const rightFace = landmarks[454];
    const nose = landmarks[1];
    const chin = landmarks[152];
    const forehead = landmarks[10];

    // 顔の幅・高さ
    const faceWidth = getDistance(leftFace, rightFace);
    const faceHeight = getDistance(forehead, chin);

    // Roll (首の傾き)
    const dx = rightFace.x - leftFace.x;
    const dy = rightFace.y - leftFace.y;
    const roll = Math.atan2(dy, dx) * (180 / Math.PI);

    // Yaw (横向き)
    const noseDist = getDistance(leftFace, nose);
    const yaw = ((noseDist / faceWidth) - 0.5) * 200;

    // Pitch (縦向き)
    const noseY = getDistance(forehead, nose);
    const pitch = ((noseY / faceHeight) - 0.5) * 200;

    // 3. Gaze (視線 - Iris)
    let gazeScore = 0;
    if (landmarks[468] && landmarks[473]) {
        const getEyeRatio = (iris, inner, outer) => {
            const width = getDistance(inner, outer);
            const distToInner = getDistance(inner, iris);
            return (distToInner / width) - 0.5;
        };
        const leftGaze = getEyeRatio(landmarks[468], landmarks[33], landmarks[133]);
        const rightGaze = getEyeRatio(landmarks[473], landmarks[362], landmarks[263]);
        gazeScore = (Math.abs(leftGaze) + Math.abs(rightGaze)) / 2;
    }

    return { roll, yaw, pitch, ear, gaze: gazeScore };
  };

  // 判定処理
  const processFrame = useCallback((landmarks) => {
    const rawData = calculateData(landmarks);

    // スムージング
    historyRef.current.push(rawData);
    if (historyRef.current.length > HISTORY_SIZE) historyRef.current.shift();

    const avgData = historyRef.current.reduce((acc, curr) => ({
      roll: acc.roll + curr.roll,
      yaw: acc.yaw + curr.yaw,
      pitch: acc.pitch + curr.pitch,
      ear: acc.ear + curr.ear,
      gaze: acc.gaze + curr.gaze,
    }), { roll: 0, yaw: 0, pitch: 0, ear: 0, gaze: 0 });

    const len = historyRef.current.length;
    const smoothData = {
      roll: avgData.roll / len,
      yaw: avgData.yaw / len,
      pitch: avgData.pitch / len,
      ear: avgData.ear / len,
      gaze: avgData.gaze / len
    };

    // スコア計算
    let tempScore = 100;
    if (Math.abs(smoothData.roll) > 10) tempScore -= 10;
    if (Math.abs(smoothData.yaw) > 15) tempScore -= 20;
    if (Math.abs(smoothData.pitch) > 15) tempScore -= 20;
    if (smoothData.gaze > 0.15) tempScore -= 30;
    if (smoothData.ear < 0.22) tempScore -= 50;

    tempScore = Math.max(0, Math.min(100, tempScore));
    setScore(Math.round(tempScore));
    setIsFocused(tempScore > 60);

  }, []);

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
      setIsLoaded(true);
      
      // 映像/Canvasの描画処理（カメラ表示モードの時だけ描画する）
      const canvas = canvasRef.current;
      const video = videoRef.current;
      
      if (canvas && video && results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        processFrame(landmarks); // 計算は常に行う

        if (showCamera) {
             // カメラ表示ONなら描画する
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#00C853';
            landmarks.forEach((point, index) => {
                if (index % 10 === 0) {
                    ctx.beginPath();
                    ctx.arc(point.x * canvas.width, point.y * canvas.height, 1, 0, 2 * Math.PI);
                    ctx.fill();
                }
            });
            ctx.restore();
        }
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

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center transition-colors duration-1000 ${isFocused ? 'bg-slate-50' : 'bg-red-50'}`}>
      
      <Script src="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js" strategy="afterInteractive" />
      <Script 
        src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" 
        strategy="afterInteractive" 
        onLoad={startProcessing}
      />

      {/* メインUIエリア */}
      <div className="relative w-full max-w-2xl aspect-video flex flex-col items-center justify-center">
        
        {/* --- 隠しビデオ要素 (透明にして配置) --- */}
        {/* display:noneにするとMediaPipeが止まることがあるため、opacity-0で隠す */}
        <div className={`absolute inset-0 rounded-2xl overflow-hidden transition-opacity duration-500 ${showCamera ? 'opacity-100 z-10 border-4 border-gray-200' : 'opacity-0 z-0'}`}>
            <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full scale-x-[-1]" />
        </div>

        {/* --- 集中モードUI (カメラOFF時に表示) --- */}
        <div className={`absolute inset-0 flex flex-col items-center justify-center z-20 transition-opacity duration-500 ${showCamera ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            
            {/* 状態を表す円のアニメーション */}
            {!isLoaded ? (
                <div className="text-gray-400 animate-pulse">システム起動中...</div>
            ) : (
                <div className="relative flex items-center justify-center">
                    {/* 背景のグロー効果 */}
                    <div className={`absolute w-64 h-64 rounded-full blur-3xl transition-colors duration-1000 ${isFocused ? 'bg-green-200' : 'bg-red-200'}`}></div>
                    
                    {/* メインサークル */}
                    <div 
                        className={`w-48 h-48 rounded-full flex flex-col items-center justify-center shadow-lg transition-all duration-1000 
                        ${isFocused ? 'bg-white scale-100 border-4 border-green-100' : 'bg-red-500 scale-110 border-4 border-red-300'}
                        `}
                    >
                        {isFocused ? (
                            <>
                                <span className="text-4xl font-light text-green-600 animate-pulse">{score}</span>
                                <span className="text-xs text-green-400 mt-2 font-bold tracking-widest">FOCUSING</span>
                            </>
                        ) : (
                            <>
                                <span className="text-5xl mb-2">⚠️</span>
                                <span className="text-white font-bold">集中切れ</span>
                            </>
                        )}
                    </div>
                </div>
            )}
            
            <p className="mt-8 text-gray-400 text-sm font-light">
                {isFocused ? "このまま作業を続けてください" : "姿勢を正して、画面に向かいましょう"}
            </p>
        </div>

      </div>

      {/* コントロールバー (画面下部) */}
      <div className="fixed bottom-8 flex gap-4 bg-white px-6 py-3 rounded-full shadow-xl border border-gray-100 z-50">
          <button 
            onClick={() => setShowCamera(!showCamera)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-black transition-colors"
          >
            {showCamera ? (
                <><span>📷</span> 映像を隠す</>
            ) : (
                <><span>🔧</span> カメラ位置を確認</>
            )}
          </button>
      </div>

    </div>
  );
}
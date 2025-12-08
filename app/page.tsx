'use client';

import React, { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

export default function StandardFocusMonitor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  //状態管理
  const [isLoaded, setIsLoaded] = useState(false);
  const [status, setStatus] = useState('システム起動中...');
  const [data, setData] = useState({ roll: 0, yaw: 0, pitch: 0, ear: 0 });
  const [baseline, setBaseline] = useState<any>(null); 
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  // --- 計算ロジック ---
  const getDistance = (p1: any, p2: any) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  const calculateData = (landmarks: any) => {
    // EAR (目の開き具合)
    const leftEyeH = getDistance(landmarks[33], landmarks[133]);
    const leftEyeV = (getDistance(landmarks[160], landmarks[144]) + getDistance(landmarks[158], landmarks[153])) / 2;
    const leftEAR = leftEyeV / leftEyeH;

    const rightEyeH = getDistance(landmarks[362], landmarks[263]);
    const rightEyeV = (getDistance(landmarks[385], landmarks[380]) + getDistance(landmarks[387], landmarks[373])) / 2;
    const rightEAR = rightEyeV / rightEyeH; 

    const ear = (leftEAR + rightEAR) / 2;

    // 姿勢 (簡易計算)
    const leftEyeCenter = landmarks[33];
    const rightEyeCenter = landmarks[263];
    const dx = rightEyeCenter.x - leftEyeCenter.x;
    const dy = rightEyeCenter.y - leftEyeCenter.y;
    const roll = Math.atan2(dy, dx) * (180 / Math.PI);

    const nose = landmarks[1];
    const leftFace = landmarks[234];
    const rightFace = landmarks[454];
    const faceWidth = getDistance(leftFace, rightFace);
    const noseDist = getDistance(leftFace, nose);
    const yaw = ((noseDist / faceWidth) - 0.5) * 200;

    const chin = landmarks[152];
    const forehead = landmarks[10];
    const faceHeight = getDistance(forehead, chin);
    const noseY = getDistance(forehead, nose);
    const pitch = ((noseY / faceHeight) - 0.5) * 200;

    return { roll, yaw, pitch, ear };
  };

  //判定ロジック
  const checkConcentration = (current: any) => {
    if (!baseline) {
      setStatus("待機中 - ボタンを押して開始");
      return;
    }

    const diffRoll = Math.abs(current.roll - baseline.roll);
    const diffYaw = Math.abs(current.yaw - baseline.yaw);
    const diffPitch = Math.abs(current.pitch - baseline.pitch);
    const diffEAR = baseline.ear - current.ear;

    // 感度調整
    const thresholds = { 
      roll: 10,   // 首の傾き
      yaw: 15,    // よそ見
      pitch: 15,  // うつむき
      ear: 0.04   // 目の閉じ具合
    };

    let alerts = [];

    if (diffRoll > thresholds.roll) alerts.push("姿勢崩れ");
    if (diffYaw > thresholds.yaw) alerts.push("よそ見");
    if (diffPitch > thresholds.pitch) alerts.push("うつむき");
    if (diffEAR > thresholds.ear) alerts.push("眠気");

    if (alerts.length > 0) {
      setAlertMessage(alerts.join(" / "));
      setStatus("⚠️ 集中低下");
    } else {
      setAlertMessage(null);
      setStatus("✅ 集中しています");
    }
  };

  //ボタン操作
  const toggleMonitoring = () => {
    if (baseline) {
      // 停止処理
      setBaseline(null);
      setAlertMessage(null);
      setStatus("待機中 - ボタンを押して開始");
    } else {
      // 開始処理
      if (data.ear !== 0) {
        setBaseline(data);
        setAlertMessage(null);
        setStatus("✅ 集中しています");
      }
    }
  };

  //MediaPipe起動
  const startProcessing = async () => {
    if (!(window as any).FaceMesh || !(window as any).Camera) return;

    const faceMesh = new (window as any).FaceMesh({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults((results: any) => {
      setIsLoaded(true);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        
        // 点を描画
        ctx.fillStyle = '#00C853';
        landmarks.forEach((point: any, index: number) => {
          if (index % 10 === 0) { 
            const x = point.x * canvas.width;
            const y = point.y * canvas.height;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fill();
          }
        });

        const newData = calculateData(landmarks);
        setData(newData);
        // 常に判定ロジックを回す
        checkConcentration(newData);
      }
      ctx.restore();
    });

    if (videoRef.current) {
      const camera = new (window as any).Camera(videoRef.current, {
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
    <div className={`min-h-screen font-sans p-6 flex flex-col items-center transition-colors duration-500 ${alertMessage ? 'bg-red-50' : 'bg-gray-50'}`}>
      
      <Script src="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js" strategy="afterInteractive" />
      <Script 
        src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" 
        strategy="afterInteractive" 
        onLoad={startProcessing}
      />

      {/* ヘッダー */}
      <header className="w-full max-w-4xl mb-8 flex justify-between items-center border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-bold text-gray-700">集中力モニター</h1>
        <div className={`px-4 py-2 rounded-full font-bold text-sm shadow-sm transition-colors duration-300 ${alertMessage ? 'bg-red-100 text-red-600 animate-pulse' : baseline ? 'bg-green-100 text-green-700' : 'bg-white text-gray-500'}`}>
          {status}
        </div>
      </header>

      <main className="flex flex-col md:flex-row gap-8 w-full max-w-5xl items-start">
        
        {/* 左側：カメラ映像 */}
        <div className="flex-1 w-full relative group">
          <div className={`relative rounded-2xl overflow-hidden shadow-lg border-4 transition-colors duration-300 ${alertMessage ? 'border-red-400' : 'border-white'}`}>
            {/* 警告オーバーレイ */}
            {alertMessage && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-red-500/20 backdrop-blur-[2px]">
                <div className="bg-white/90 px-6 py-3 rounded-lg shadow-xl text-red-600 font-bold text-xl animate-bounce">
                  ⚠️ {alertMessage}
                </div>
              </div>
            )}

            {!isLoaded && (
              <div className="absolute inset-0 bg-gray-100 flex items-center justify-center text-gray-400 z-10">
                カメラを起動しています...
              </div>
            )}
            
            <video ref={videoRef} className="w-full h-auto object-cover scale-x-[-1]" playsInline muted />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full scale-x-[-1]" />
          </div>
          <p className="text-center text-gray-400 text-xs mt-2">カメラ映像はサーバーには送信されません</p>
        </div>

        {/* 右側：データと操作 */}
        <div className="w-full md:w-80 flex flex-col gap-6">
          
          {/* 操作ボタン */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-gray-500 text-xs font-bold mb-4 uppercase tracking-wider">設定</h2>
            <button
              onClick={toggleMonitoring}
              className={`w-full py-4 rounded-lg font-bold text-white shadow-md transition-all active:scale-95 
                ${baseline 
                  ? 'bg-gray-600 hover:bg-gray-500' 
                  : 'bg-blue-600 hover:bg-blue-500 animate-pulse'
                }`}
            >
              {baseline ? '監視を停止 / リセット' : '現在の姿勢で開始'}
            </button>
            <p className="text-xs text-gray-400 mt-2 text-center">
              {baseline ? '再設定する場合は一度停止してください' : '背筋を伸ばし、集中している時の姿勢で押してください'}
            </p>
          </div>

          {/* 数値データ */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-gray-500 text-xs font-bold mb-4 uppercase tracking-wider">現在の状態</h2>
            
            <div className="space-y-4">
              <MetricBar label="首の傾き" value={data.roll} max={45} alert={baseline && Math.abs(data.roll - baseline.roll) > 10} />
              <MetricBar label="よそ見" value={data.yaw} max={45} alert={baseline && Math.abs(data.yaw - baseline.yaw) > 15} />
              <MetricBar label="うつむき" value={data.pitch} max={45} alert={baseline && Math.abs(data.pitch - baseline.pitch) > 15} />
              
              <div className="pt-2 border-t border-gray-100">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">目の開き具合</span>
                  <span className="font-mono text-gray-400">{data.ear.toFixed(3)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${data.ear < 0.2 ? 'bg-red-400' : 'bg-green-400'}`}
                    style={{ width: `${Math.min(data.ear * 300, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

// グラフ表示用の部品
function MetricBar({ label, value, max, alert }: { label: string, value: number, max: number, alert: boolean | null }) {
  const percent = Math.min(Math.abs(value) / max * 100, 100);
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className={alert ? 'text-red-500 font-bold' : 'text-gray-600'}>{label}</span>
        <span className="font-mono text-gray-400">{value.toFixed(1)}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div 
          className={`h-full transition-all duration-300 ${alert ? 'bg-red-500' : 'bg-blue-400'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
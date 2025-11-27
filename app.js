// app.js (修正後的 startCamera 函式)

function startCamera() {
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment', // 優先使用後置鏡頭
        }
    })
    .then(stream => {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            // 確保 video 元素大小設定正確
            canvasOutput.width = video.videoWidth;
            canvasOutput.height = video.videoHeight;
            
            // 初始化 OpenCV Mat 結構
            src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
            dst = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);

            // 使用 video.play() 的 Promise 確保畫面開始播放
            video.play().then(() => {
                streaming = true;
                statusDiv.innerHTML = '相機已啟動。請將名片置於畫面中央。';
                
                // 只有在播放成功後才開始處理迴圈
                processVideo(); 
            }).catch(e => {
                statusDiv.innerHTML = '錯誤：影像播放失敗。請檢查瀏覽器設定。';
                console.error("Video play failed:", e);
            });
        };
    })
    .catch(err => {
        statusDiv.innerHTML = `錯誤：無法存取相機。請檢查權限。(Error: ${err.name})`;
        console.error("無法存取相機:", err);
    });
}

const video = document.getElementById('video');
const canvasOutput = document.getElementById('canvasOutput');
const statusDiv = document.getElementById('status');
let cap = null;
let src = null;
let dst = null;
let streaming = false;

// 1. 等待 OpenCV.js 載入完成
function onOpenCvReady() {
    statusDiv.innerHTML = 'OpenCV 載入完成，正在啟動相機...';
    // 確保 cv.Mat 初始化延後到 video 元素設定大小之後
    startCamera();
}

// 2. 啟動相機
function startCamera() {
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment', // 優先使用後置鏡頭
            // 移除進階設定以提升 iOS 相容性
        }
    })
    .then(stream => {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            streaming = true;
            statusDiv.innerHTML = '相機已啟動。請將名片置於畫面中央。';
            
            // 設定 canvas 大小與 video 串流的像素解析度相同
            canvasOutput.width = video.videoWidth;
            canvasOutput.height = video.videoHeight;
            
            // 初始化 OpenCV Mat 結構
            src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
            dst = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);

            // 開始處理每一幀畫面
            processVideo(); 
        };
    })
    .catch(err => {
        statusDiv.innerHTML = `錯誤：無法存取相機。請檢查權限。(Error: ${err.name})`;
        console.error("無法存取相機:", err);
    });
}

// 3. 影像處理迴圈 (核心邏輯)
function processVideo() {
    if (!streaming || !cap) {
        cap = new cv.VideoCapture(video);
    }
    
    // 讀取當前畫面
    cap.read(src);

    // 複製一份影像用於繪圖，保持原始 src 乾淨
    src.copyTo(dst); 

    // 將畫面從彩色轉為灰階 (可選，通常是 CV 處理的第一步)
    // cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0); 
    
    // ===============================================
    // *** TODO: 名片偵測和自動拍攝邏輯開發區 ***
    // ===============================================

    let cardContour = detectCardBoundary(src); 

    if (cardContour) {
        // 繪製邊框，實現動態效果
        drawContour(dst, cardContour); 

        // 檢查名片是否清晰且穩定
        if (isCardStableAndClear(cardContour)) {
             // 拍攝後可能需要停止 processVideo 迴圈
             // takeSnapshot(src, cardContour); 
        }
    }
    
    // 將處理後的影像輸出到 canvas
    cv.imshow('canvasOutput', dst); 
    
    // 請求下一幀畫面 (實現連續處理)
    requestAnimationFrame(processVideo); 
}

// ----------------------------------------------------------------
// TODO: 請在這裡實作您的電腦視覺函式！
// ----------------------------------------------------------------

function detectCardBoundary(inputMat) {
    // 實作邊緣偵測、輪廓尋找、四邊形篩選的 OpenCV 步驟
    // ...
    return null; 
}

function isCardStableAndClear(contour) {
    // 實作判斷輪廓穩定性和大小的邏輯
    // ...
    return false;
}

function drawContour(outputMat, contour) {
    // 實作繪製邊框的邏輯，例如使用 cv.polylines
    // ...
}

function takeSnapshot(sourceMat, contour) {
    // 實作透視變換和圖片導出/下載的邏輯
    // ...
}

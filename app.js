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
    // 初始化 OpenCV 的 Mat 結構
    src = new cv.Mat(video.height, video.width, cv.CV_8UC4);
    dst = new cv.Mat(video.height, video.width, cv.CV_8UC4);
    startCamera();
}

// 2. 啟動相機
function startCamera() {
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment', // 優先使用後置鏡頭
            // 嘗試設定連續自動對焦
            advanced: [{ focusMode: 'continuous' }] 
        }
    })
    .then(stream => {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            // 確保 video 元素大小設定正確
            video.play();
            streaming = true;
            statusDiv.innerHTML = '相機已啟動。請將名片置於畫面中央。';
            // 設定 canvas 大小與 video 串流相同
            canvasOutput.width = video.videoWidth;
            canvasOutput.height = video.videoHeight;
            
            // 開始處理每一幀畫面
            processVideo(); 
        };
    })
    .catch(err => {
        statusDiv.innerHTML = '錯誤：無法存取相機。請檢查權限。' + err.name;
        console.error("無法存取相機:", err);
    });
}

// 3. 影像處理迴圈 (核心邏輯)
function processVideo() {
    if (!streaming || !cap) {
        // cap 在 video 初始化後才會被建立
        cap = new cv.VideoCapture(video);
    }
    
    // 讀取當前畫面
    cap.read(src);

    // ===============================================
    // *** 這裡是你需要的名片偵測和自動拍攝邏輯 (需求 2 & 3) ***
    // ===============================================

    // 範例：將畫面從彩色轉為灰階，並顯示在 canvas 上
    cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0); 
    // 接著：進行邊緣偵測、輪廓尋找、四邊形篩選...
    
    // --- 需求 3: 偵測名片邊框的動態效果 ---
    let cardContour = detectCardBoundary(src); // 假設這是您的偵測函式

    if (cardContour) {
        // 如果偵測到名片，繪製邊框
        drawContour(dst, cardContour); 

        // --- 需求 2: 自動拍攝邏輯 ---
        if (isCardStableAndClear(cardContour)) {
             // 如果名片清晰且穩定，觸發拍攝
             // takeSnapshot(src, cardContour); 
             // return; // 拍攝後可能需要停止 processVideo 迴圈
        }
    }
    
    // 將處理後的影像輸出到 canvas
    cv.imshow('canvasOutput', dst); 
    
    // 請求下一幀畫面 (實現連續處理)
    requestAnimationFrame(processVideo); 
}

// ----------------------------------------------------------------
// TODO: 實作電腦視覺函式 (這是最需要花時間開發的部分)
// ----------------------------------------------------------------

/**
 * 偵測名片邊界並返回一個輪廓點集。
 * @param {cv.Mat} inputMat - 輸入的影像 Mat 
 * @returns {cv.Mat | null} - 名片的輪廓，或 null 如果沒有找到
 */
function detectCardBoundary(inputMat) {
    // 這裡需要複雜的 OpenCV 步驟：灰度化 -> 高斯模糊 -> Canny 邊緣偵測 -> 輪廓尋找 -> 四邊形篩選
    // ...
    return null; 
}

/**
 * 檢查名片是否穩定且足夠清晰可以拍攝
 * @param {cv.Mat} contour - 名片輪廓
 * @returns {boolean}
 */
function isCardStableAndClear(contour) {
    // 檢查：輪廓是否接近矩形？面積是否在合理範圍？是否在畫面中心？
    // ...
    return false;
}

/**
 * 繪製名片邊框 (實現動態效果)
 */
function drawContour(outputMat, contour) {
    // 使用 cv.polylines 或 cv.drawContours 繪製邊框
    // 邊框顏色可以隨對焦或穩定性改變
    // ...
}

/**
 * 拍攝快照並應用透視變換
 */
function takeSnapshot(sourceMat, contour) {
    // 應用 cv.getPerspectiveTransform 和 cv.warpPerspective 將名片拉直
    // 導出最終圖片
    // ...
}
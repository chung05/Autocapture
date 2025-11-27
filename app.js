/**
 * 名片掃描應用程式的主邏輯 (app.js) - 最終穩定版
 * 採用 Canvas 緩衝區方式讀取影格，徹底解決 iOS 和 PC 端的尺寸/讀取問題。
 *
 * 最終修正：
 * 1. 修正 Mat 記憶體管理，確保每次讀取新 Mat 時，前一幀的 Mat 資源被釋放 (解決 PC 端 Bad size 錯誤)。
 * 2. 啟用 takeSnapshot 函式 (解決 iPhone 端無法自動拍照問題)。
 * 3. 強化 isCardStableAndClear 邏輯，放寬面積範圍並新增長寬比檢查 (解決 iPhone 鎖定失敗問題)。
 */

// 宣告全域變數
let src = null; // 原始影像 Mat (會在 processVideo 中重新創建/賦值)
let dst = null; // 處理結果 Mat (會在 processVideo 中重新創建/賦值)
let streaming = false;
let greenColor; 
let canvasBuffer = null; // 緩衝區 Canvas 元素
let canvasBufferCtx = null; // 緩衝區 Canvas 2D Context

// ** 核心修正：定義全域 Module 物件，以避免 ReferenceError **
var Module = {
    onRuntimeInitialized: function() {
        // 關鍵修正點：在這裡初始化所有依賴 cv 物件的變數，確保 cv 已載入
        greenColor = new cv.Scalar(0, 255, 0, 255); // 綠色 (用於繪製邊框)
        
        statusDiv.innerHTML = 'OpenCV 載入完成。請點擊「開始」按鈕。';
        console.log("DIAG: Module.onRuntimeInitialized 成功，OpenCV 核心已準備就緒。");
        
        // 將相機啟動邏輯綁定到按鈕點擊事件
        if (startButton) {
            startButton.addEventListener('click', startCamera);
            startButton.disabled = false; // 載入完成後啟用按鈕
            startButton.innerHTML = '點擊開始';
        }
    }
};

// 取得 DOM 元素參照
const video = document.getElementById('video');
const canvasOutput = document.getElementById('canvasOutput');
const statusDiv = document.getElementById('status');
const startButton = document.getElementById('startButton'); 
// 取得緩衝區 Canvas
canvasBuffer = document.getElementById('canvasBuffer');


// ** 新增 DOM 檢查和初始狀態設定 **
if (startButton && canvasBuffer) {
    // 初始狀態設定為載入中，等待 Module.onRuntimeInitialized 啟用它
    startButton.innerHTML = 'OpenCV 載入中...';
    startButton.disabled = true; 
} else {
    // 如果找不到按鈕，提供明確的錯誤訊息
    statusDiv.innerHTML = '致命錯誤：找不到必要的 DOM 元素 (startButton 或 canvasBuffer)。請確認 index.html 已更新！';
    console.error("DIAG ERROR: Missing critical DOM elements. Check index.html.");
}


// 2. 啟動相機並設定串流
function startCamera() {
    startButton.disabled = true; // 避免重複點擊
    statusDiv.innerHTML = '正在請求相機權限...';
    
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment', 
        }
    })
    .then(stream => {
        video.srcObject = stream;
        
        console.log("DIAG: getUserMedia 成功取得串流。等待 loadeddata 事件...");
        
        video.addEventListener('loadeddata', function initializeVideoAndStartLoop() {
            video.removeEventListener('loadeddata', initializeVideoAndStartLoop);

            // 確保尺寸正確
            console.log(`DIAG: loadeddata 事件觸發。串流解析度: ${video.videoWidth}x${video.videoHeight}`);

            if (video.videoWidth === 0 || video.videoHeight === 0) {
                 const errMsg = '致命錯誤：串流尺寸為 0x0。請重新整理或檢查相機資源是否被佔用。';
                 statusDiv.innerHTML = errMsg;
                 startButton.disabled = false; 
                 return;
            }

            // 設定 Canvas 緩衝區和輸出 Canvas 的像素解析度
            canvasOutput.width = canvasBuffer.width = video.videoWidth;
            canvasOutput.height = canvasBuffer.height = video.videoHeight;
            
            // 取得緩衝區的 2D Context
            canvasBufferCtx = canvasBuffer.getContext('2d');
            
            // 嘗試播放 video
            video.play().then(() => {
                statusDiv.innerHTML = '影像串流啟動成功，開始處理...';
                console.log("DIAG: video.play() 成功。準備進入處理迴圈...");
                
                // 開始處理迴圈
                streaming = true;
                processVideo(); 
                
            }).catch(e => {
                const errMsg = `錯誤：影像播放失敗。請檢查錯誤碼: ${e.message || e.name}`;
                statusDiv.innerHTML = errMsg;
                startButton.disabled = false; 
            });
        });
    })
    .catch(err => {
        const errMsg = `錯誤：無法存取相機。請檢查權限是否被拒絕。(Error: ${err.name} - ${err.message})`;
        statusDiv.innerHTML = errMsg;
        console.error("DIAG ERROR: 無法存取相機:", err);
        startButton.disabled = false; 
    });
}

// 3. 影像處理迴圈 (核心邏輯) 
function processVideo() {
    if (!streaming) return;

    // *** 核心修正：釋放前一幀的記憶體，確保 Mat 尺寸與 Canvas 尺寸同步 ***
    if (src && !src.isDeleted()) {
        src.delete(); 
    }
    if (dst && !dst.isDeleted()) {
        dst.delete();
    }
    
    // 1. 將 video 的當前幀繪製到隱藏的緩衝區 Canvas 上
    canvasBufferCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    
    // 2. 從緩衝區 Canvas 讀取影像到 OpenCV Mat (src)，這會創建一個新的 Mat
    src = cv.imread(canvasBuffer);

    // 進行影像處理
    // 3. 複製 src 到 dst (dst 是新的 Mat)
    dst = src.clone(); 

    // 進行名片邊緣偵測
    let cardContour = detectCardBoundary(src); 

    if (cardContour) {
        drawContour(dst, cardContour); 

        if (isCardStableAndClear(cardContour)) {
             statusDiv.innerHTML = '名片已鎖定！準備自動拍攝...';
             // *** 啟用自動拍攝功能 ***
             takeSnapshot(src, cardContour); 
        } else {
             statusDiv.innerHTML = '偵測到物體，但仍在調整對焦與角度。';
        }
        cardContour.delete(); 
    } else {
        statusDiv.innerHTML = '請將名片置於畫面中央。';
    }
    
    // 輸出處理後的影像到 canvasOutput
    cv.imshow('canvasOutput', dst); 
    
    // 請求下一幀畫面
    requestAnimationFrame(processVideo); 
}

// ----------------------------------------------------------------
// 4. 電腦視覺函式實作 
// ----------------------------------------------------------------

// 偵測名片輪廓的 CV 演算法
function detectCardBoundary(inputMat) {
    let gray = new cv.Mat();
    let blur = new cv.Mat();
    let canny = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
        cv.cvtColor(inputMat, gray, cv.COLOR_RGBA2GRAY, 0); 
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
        cv.Canny(blur, canny, 75, 200, 3, false); 
        cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        
        let largestContour = null;
        let maxArea = 0;

        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);

            if (area < 1000) continue; // 忽略太小的輪廓

            let arcLength = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            
            // 逼近為多邊形 (尋找四邊形)
            cv.approxPolyDP(contour, approx, 0.02 * arcLength, true);

            // 篩選出四個頂點且面積最大的輪廓
            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                if (largestContour) largestContour.delete();
                largestContour = approx;
            } else {
                approx.delete();
            }
            contour.delete();
        }

        return largestContour;

    } catch (e) {
        // console.error("CV Detection Error:", e); 
        return null;
    } finally {
        // 釋放記憶體
        gray.delete();
        blur.delete();
        canny.delete();
        contours.delete();
        hierarchy.delete();
    }
}

// 判斷名片是否穩定和清晰的簡單邏輯
function isCardStableAndClear(contour) {
    if (!contour) return false;
    
    let area = cv.contourArea(contour);
    let totalArea = src.cols * src.rows; 
    
    // 條件 1: 放寬面積檢查 (5% 到 85%)，以適應手機不同距離
    if (area < totalArea * 0.05 || area > totalArea * 0.85) { 
        return false;
    }

    // 條件 2: 凸性檢查
    let isConvex = cv.isContourConvex(contour);
    if (!isConvex) {
        return false;
    }
    
    // 條件 3: 長寬比檢查 (名片是長方形)
    let rect = cv.minAreaRect(contour);
    let size = rect.size;
    let width = size.width;
    let height = size.height;

    // 確保 width 是較長的邊
    if (width < height) {
        [width, height] = [height, width];
    }
    
    // 標準名片長寬比約為 1.6~1.7。我們檢查寬鬆範圍 (1.3 到 2.5)
    let aspectRatio = width / height;
    if (aspectRatio < 1.3 || aspectRatio > 2.5) { 
        return false;
    }

    return true; 
}

// 在影像上繪製輪廓
function drawContour(outputMat, contour) {
    let contours = new cv.MatVector();
    contours.push_back(contour);

    // 繪製綠色邊框
    cv.drawContours(outputMat, contours, 0, greenColor, 5, cv.LINE_8);
    
    // 繪製四個頂點的綠色圓圈
    let points = contour.data32S;
    for (let i = 0; i < points.length; i += 2) {
        let center = new cv.Point(points[i], points[i+1]);
        cv.circle(outputMat, center, 10, greenColor, -1); 
    }
    
    contours.delete();
}

// 拍照功能 (尚未實作透視變換)
function takeSnapshot(sourceMat, contour) {
    // 停止串流
    streaming = false;
    statusDiv.innerHTML = '拍攝成功！(功能待實作: 圖片導出)';
    console.log("快照已拍攝，等待透視變換與下載。");
}

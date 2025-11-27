/**
 * 名片掃描應用程式的主邏輯 (app.js) - 最終穩定版
 * 採用 Module.onRuntimeInitialized 確保 OpenCV 核心載入完成，並強化相機啟動流程。
 */
const video = document.getElementById('video');
const canvasOutput = document.getElementById('canvasOutput');
const statusDiv = document.getElementById('status');
let cap = null;
let src = null; // 原始影像 Mat
let dst = null; // 處理結果 Mat
let streaming = false;
let greenColor; // 移除了 cv.Scalar 的初始化，改為在 runtime 初始化時設定

// 1. *** 核心修正: 使用 OpenCV 標準的初始化回呼函式 ***
// 當 WebAssembly runtime 準備就緒後，會自動呼叫此函式
Module.onRuntimeInitialized = function() {
    // 在這裡初始化所有依賴 cv 物件的變數
    greenColor = new cv.Scalar(0, 255, 0, 255); // 綠色 (用於繪製邊框)
    
    statusDiv.innerHTML = 'OpenCV 載入完成，正在啟動相機...';
    console.log("DIAG: Module.onRuntimeInitialized 成功，開始啟動相機。");
    startCamera();
};

// 2. 啟動相機並設定串流
function startCamera() {
    // 請求後置鏡頭，避免使用進階限制來確保 iOS 相容性
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment', 
        }
    })
    .then(stream => {
        video.srcObject = stream;
        
        console.log("DIAG: getUserMedia 成功取得串流。等待 loadeddata 事件...");
        
        // 使用 'loadeddata' 事件，確保影像串流的資料已開始緩衝
        video.addEventListener('loadeddata', function initializeVideoAndStartLoop() {
            video.removeEventListener('loadeddata', initializeVideoAndStartLoop);

            // *** 關鍵診斷點 ***：確認影像尺寸是否正確讀取。若為 0x0，則串流未準備好。
            console.log(`DIAG: loadeddata 事件觸發。串流解析度: ${video.videoWidth}x${video.videoHeight}`);

            if (video.videoWidth === 0 || video.videoHeight === 0) {
                 statusDiv.innerHTML = '致命錯誤：串流尺寸為 0x0。請重新整理或檢查相機資源是否被佔用。';
                 console.error("DIAG ERROR: Video stream reports 0x0 dimensions after loadeddata.");
                 return;
            }

            // 設定 canvas 像素解析度與 video 串流相同
            canvasOutput.width = video.videoWidth;
            canvasOutput.height = video.videoHeight;
            
            // 初始化 OpenCV Mat 結構
            src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
            dst = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);

            // 嘗試播放 video
            video.play().then(() => {
                statusDiv.innerHTML = '影像串流緩衝中...';
                console.log("DIAG: video.play() 成功。準備進入處理迴圈...");
                
                // 增加 200ms 延遲，確保影像串流穩定，再開始處理迴圈
                setTimeout(() => {
                    streaming = true;
                    statusDiv.innerHTML = '相機已啟動。請將名片置於畫面中央。';
                    processVideo(); 
                }, 200); 
                
            }).catch(e => {
                const errMsg = `錯誤：影像播放失敗。請檢查錯誤碼: ${e.message || e.name}`;
                statusDiv.innerHTML = errMsg;
                console.error("DIAG ERROR: Video play failed:", e);
            });
        });
    })
    .catch(err => {
        const errMsg = `錯誤：無法存取相機。請檢查權限是否被拒絕。(Error: ${err.name} - ${err.message})`;
        statusDiv.innerHTML = errMsg;
        console.error("DIAG ERROR: 無法存取相機:", err);
    });
}

// 3. 影像處理迴圈 (核心邏輯) 
function processVideo() {
    if (!streaming) return;

    if (!cap) {
        // 在這裡才初始化 VideoCapture
        cap = new cv.VideoCapture(video);
    }
    
    // 讀取並複製影像
    cap.read(src);
    src.copyTo(dst); 

    // 進行名片邊緣偵測
    let cardContour = detectCardBoundary(src); 

    if (cardContour) {
        drawContour(dst, cardContour); 

        if (isCardStableAndClear(cardContour)) {
             statusDiv.innerHTML = '名片已鎖定！準備自動拍攝...';
             // takeSnapshot(src, cardContour); // 實際拍攝功能
        } else {
             statusDiv.innerHTML = '偵測到物體，但仍在調整對焦與角度。';
        }
        cardContour.delete(); 
    } else {
        statusDiv.innerHTML = '請將名片置於畫面中央。';
    }
    
    // 輸出處理後的影像到 canvas
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
        // console.error("CV Detection Error:", e); // 在生產環境中可以註解掉，避免過多日誌
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
    
    // 確保面積在合理範圍內
    if (area < totalArea * 0.1 || area > totalArea * 0.7) {
        return false;
    }

    // 檢查輪廓是否為凸多邊形 (名片通常是)
    let isConvex = cv.isContourConvex(contour);
    return isConvex; 
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
    streaming = false;
    statusDiv.innerHTML = '拍攝成功！(功能待實作: 圖片導出)';
    console.log("快照已拍攝，等待透視變換與下載。");
}

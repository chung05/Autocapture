/**
 * 名片掃描應用程式的主邏輯 (app.js)
 * 整合了相機存取、OpenCV.js 初始化、影像處理迴圈、以及名片邊框偵測與視覺化。
 */
const video = document.getElementById('video');
const canvasOutput = document.getElementById('canvasOutput');
const statusDiv = document.getElementById('status');
let cap = null;
let src = null; // 原始影像 Mat
let dst = null; // 處理結果 Mat
let streaming = false;
let greenColor = new cv.Scalar(0, 255, 0, 255); // 綠色 (用於繪製邊框)

// 1. 等待 OpenCV.js 載入完成
function onOpenCvReady() {
    statusDiv.innerHTML = 'OpenCV 載入完成，正在啟動相機...';
    startCamera();
}

// 2. 啟動相機並設定串流
function startCamera() {
    // 請求後置鏡頭影像串流
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment', // 優先使用後置鏡頭
        }
    })
    .then(stream => {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            // 設定 canvas 像素解析度與 video 串流相同
            canvasOutput.width = video.videoWidth;
            canvasOutput.height = video.videoHeight;
            
            // 初始化 OpenCV Mat 結構
            src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
            dst = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);

            // 確保 video 播放成功，然後再開始處理迴圈 (解決 iOS 問題)
            video.play().then(() => {
                streaming = true;
                statusDiv.innerHTML = '相機已啟動。請將名片置於畫面中央。';
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

// 3. 影像處理迴圈 (核心邏輯)
function processVideo() {
    if (!streaming) return;

    if (!cap) {
        cap = new cv.VideoCapture(video);
    }
    
    // 讀取當前畫面到 src
    cap.read(src);

    // 複製原始影像到 dst，作為繪圖基礎
    src.copyTo(dst); 
    
    // ===============================================
    // *** 實作名片偵測和邊框繪製邏輯 ***
    // ===============================================

    // 嘗試偵測名片邊界
    let cardContour = detectCardBoundary(src); 

    if (cardContour) {
        // 繪製邊框，實現動態效果
        drawContour(dst, cardContour); 

        // 檢查名片是否清晰且穩定
        if (isCardStableAndClear(cardContour)) {
             statusDiv.innerHTML = '名片已鎖定！準備自動拍攝...';
             // *** 需求 2: 自動拍攝 (目前註解掉，確保偵測穩定) ***
             // takeSnapshot(src, cardContour); 
             // return; 
        } else {
             statusDiv.innerHTML = '偵測到物體，但仍在調整對焦與角度。';
        }
        cardContour.delete(); // 釋放內存
    } else {
        statusDiv.innerHTML = '請將名片置於畫面中央。';
    }
    
    // 將處理後的影像輸出到 canvas
    cv.imshow('canvasOutput', dst); 
    
    // 請求下一幀畫面 (實現連續處理)
    requestAnimationFrame(processVideo); 
}

// ----------------------------------------------------------------
// 4. 電腦視覺函式實作
// ----------------------------------------------------------------

/**
 * 偵測名片邊界並返回一個輪廓點集。
 * 使用 Canny 邊緣偵測和輪廓尋找來尋找最大的四邊形。
 * @param {cv.Mat} inputMat - 輸入的影像 Mat 
 * @returns {cv.Mat | null} - 名片的輪廓，或 null 如果沒有找到
 */
function detectCardBoundary(inputMat) {
    let gray = new cv.Mat();
    let blur = new cv.Mat();
    let canny = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
        // 1. 灰度化
        cv.cvtColor(inputMat, gray, cv.COLOR_RGBA2GRAY, 0); 
        
        // 2. 高斯模糊降噪 (很重要)
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
        
        // 3. Canny 邊緣偵測
        // 參數需要根據實際效果調整，這裡使用經驗值
        cv.Canny(blur, canny, 75, 200, 3, false); 
        
        // 4. 尋找輪廓
        cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        
        let largestContour = null;
        let maxArea = 0;

        // 5. 篩選輪廓：尋找最大的四邊形
        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);

            // 面積太小的輪廓直接忽略
            if (area < 1000) continue; 

            let arcLength = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            
            // 逼近多邊形，簡化輪廓 (參數 0.02 根據輪廓長度調整)
            cv.approxPolyDP(contour, approx, 0.02 * arcLength, true);

            // 篩選：我們尋找接近四邊形 (4 個角) 且面積最大的輪廓
            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                // 如果已經有最大的輪廓，需要釋放它
                if (largestContour) largestContour.delete();
                largestContour = approx;
            } else {
                // 釋放不符合條件的 approx
                approx.delete();
            }
            // 釋放 contour，因為已經被 approxPolyDP 處理或忽略
            contour.delete();
        }

        return largestContour; // 返回最大的四邊形輪廓 (cv.Mat)

    } catch (e) {
        console.error("OpenCV 偵測錯誤:", e);
        return null;
    } finally {
        // 釋放所有中間 Mat 以避免記憶體洩漏
        gray.delete();
        blur.delete();
        canny.delete();
        contours.delete();
        hierarchy.delete();
    }
}

/**
 * 檢查名片輪廓是否穩定且足夠清晰可以拍攝。
 * 這是實現自動拍攝的關鍵判斷。
 * @param {cv.Mat} contour - 名片輪廓 (4個頂點的 Mat)
 * @returns {boolean}
 */
function isCardStableAndClear(contour) {
    if (!contour) return false;
    
    // 檢查 1: 面積是否足夠大 (例如：佔整個畫面的 10% 到 70% 之間)
    let area = cv.contourArea(contour);
    let totalArea = src.cols * src.rows;
    if (area < totalArea * 0.1 || area > totalArea * 0.7) {
        return false;
    }

    // 檢查 2: 邊角是否接近 90 度 (檢查輪廓頂點的凸性)
    // 這裡我們只做一個粗略的檢查：輪廓是否凸面
    let isConvex = cv.isContourConvex(contour);
    if (!isConvex) {
        return false;
    }

    // 檢查 3: (TODO) 應加入時間序列檢查，確保輪廓在連續幾幀內移動不超過閾值 (穩定性)

    // 如果通過所有檢查，視為穩定可拍攝
    return true; 
}

/**
 * 繪製名片邊框 (實現動態效果)
 */
function drawContour(outputMat, contour) {
    let contours = new cv.MatVector();
    contours.push_back(contour);

    // 繪製綠色邊框
    cv.drawContours(outputMat, contours, 0, greenColor, 5, cv.LINE_8);
    
    // 繪製輪廓的四個頂點 (增加視覺效果)
    let points = contour.data32S;
    for (let i = 0; i < points.length; i += 2) {
        let center = new cv.Point(points[i], points[i+1]);
        cv.circle(outputMat, center, 10, greenColor, -1); // 實心圓點
    }
    
    contours.delete();
}

/**
 * 拍攝快照並應用透視變換 (TODO 待完成)
 */
function takeSnapshot(sourceMat, contour) {
    // 1. 停止處理迴圈
    streaming = false;
    
    // 2. 進行透視變換 (將傾斜的名片拉直成矩形)
    // 這需要較多的 OpenCV 程式碼，包括計算變換矩陣 M
    // cv.getPerspectiveTransform(srcPoints, dstPoints)
    // cv.warpPerspective(sourceMat, finalMat, M, newSize)

    // 3. 導出最終圖片 (Final Mat to Base64/Download)
    statusDiv.innerHTML = '拍攝成功！(功能待實作: 圖片導出)';
    console.log("快照已拍攝，等待透視變換與下載。");
}

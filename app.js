/**
 * 名片掃描應用程式的主邏輯 (app.js) - 最終記憶體安全版
 * 修正重點：
 * 1. 強化 cv.Mat 記憶體管理：使用一個變數 (contourToDelete) 確保輪廓 Mat 在每幀結束時被刪除。
 * 2. 確保 takeSnapshot() 無論成功失敗，都負責釋放傳入的輪廓 Mat。
 * 3. 繼續保持 cv.Scalar 和 cv.RotatedRect 沒有 .delete() 呼叫。
 * 4. 程式碼完全基於瀏覽器 WebRTC、Canvas 和 OpenCV.js，適用於 Web 環境。
 */

// 宣告全域變數
let src = null; 
let dst = null; 
let streaming = false;
let canvasBufferCtx = null; 

// 穩定性參數
const STABILITY_THRESHOLD = 30; // 達到此幀數後自動拍照 (約 1 秒)
const MOVEMENT_THRESHOLD = 15; // 允許的最大中心點移動距離 (像素)
const AREA_CHANGE_THRESHOLD = 0.1; // 允許的最大面積變化比例 (10%)

// 偵測超時參數
const NO_CARD_TIMEOUT_MS = 10000; // 10 秒
let noCardTimer = null; 

// 追蹤狀態
let stableFrameCount = 0;
let lastStableRectData = null; 
let autoCaptureInProgress = false; // 確保只拍一次

// 宣告 DOM 元素參照
let video = null;
let canvasOutput = null;
let statusDiv = null;
let canvasBuffer = null;
let snapshotContainer = null;
let snapshotImage = null;
let downloadSnapshot = null;
let retakeButton = null;
let timeoutContainer = null;
let timeoutRetryButton = null;


// ** 核心初始化函式：在 OpenCV 核心載入完成後被呼叫 **
function initAppWithOpenCV() {
    
    // 取得 DOM 元素參照
    video = document.getElementById('video');
    canvasOutput = document.getElementById('canvasOutput');
    statusDiv = document.getElementById('status');
    canvasBuffer = document.getElementById('canvasBuffer');
    snapshotContainer = document.getElementById('snapshotContainer');
    snapshotImage = document.getElementById('snapshotImage');
    downloadSnapshot = document.getElementById('downloadSnapshot');
    retakeButton = document.getElementById('retakeButton');
    timeoutContainer = document.getElementById('timeoutContainer');
    timeoutRetryButton = document.getElementById('timeoutRetryButton');
    
    // 初始化事件監聽器
    downloadSnapshot.addEventListener('click', downloadSnapshotImage);
    retakeButton.addEventListener('click', resetAndStartCamera);
    timeoutRetryButton.addEventListener('click', startCamera);
    
    // 載入完成後，直接開始相機
    statusDiv.innerHTML = 'OpenCV 載入完成。正在自動啟動相機...';
    console.log("DIAG: 初始化成功，自動啟動相機。");
    
    startCamera();
}

// 處理 10 秒未偵測到名片的超時
function handleNoCardTimeout() {
    if (!streaming || autoCaptureInProgress) return; 

    // 1. 停止偵測迴圈
    streaming = false;
    
    // 2. 停止相機串流
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
    
    // 3. 顯示超時訊息和重啟按鈕
    statusDiv.innerHTML = '偵測超時：請放入名片。';
    timeoutContainer.style.display = 'flex';
    
    // 4. 清理 OpenCV Mats
    cleanupOpenCVMats();
    
    // 重設穩定性狀態
    stableFrameCount = 0; 
    lastStableRectData = null; 
}


// 啟動相機並設定串流
function startCamera() {
    // 關閉任何超時 UI
    timeoutContainer.style.display = 'none';
    statusDiv.innerHTML = '正在請求相機權限...';
    autoCaptureInProgress = false; // 重啟時重設捕捉狀態
    
    // 請求高解析度並啟用連續對焦 
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment',
            width: { ideal: 1280 }, 
            height: { ideal: 720 }, 
            focusMode: "continuous" // 自動對焦
        }
    })
    .then(stream => {
        video.srcObject = stream;
        
        video.addEventListener('loadeddata', function initializeVideoAndStartLoop() {
            video.removeEventListener('loadeddata', initializeVideoAndStartLoop);

            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            
            if (videoWidth === 0 || videoHeight === 0) {
                 statusDiv.innerHTML = '致命錯誤：串流尺寸為 0x0。請重新整理。';
                 return;
            }

            // 確保 Canvas 尺寸與影片串流尺寸完全一致
            canvasOutput.width = canvasBuffer.width = videoWidth;
            canvasOutput.height = canvasBuffer.height = videoHeight;
            
            canvasBufferCtx = canvasBuffer.getContext('2d');
            
            video.play().then(() => {
                statusDiv.innerHTML = '影像串流啟動成功，請將名片置於畫面中央。';
                
                streaming = true;
                processVideo(); 
                
            }).catch(e => {
                statusDiv.innerHTML = `錯誤：影像播放失敗 (${e.message})。`;
                console.error("DIAG ERROR: 影像播放失敗:", e);
            });
        });
    })
    .catch(err => {
        statusDiv.innerHTML = `錯誤：無法存取相機。請檢查權限是否被拒絕。(Error: ${err.name})`;
        console.error("DIAG ERROR: 無法存取相機:", err);
    });
}

// 影像處理迴圈 (核心邏輯) 
function processVideo() {
    if (!streaming || autoCaptureInProgress) {
        cleanupOpenCVMats();
        return; 
    }

    // 清理上一次迴圈的 Mat 物件 (src/dst)
    cleanupOpenCVMats();

    // 確保定時器已停止，當幀率高時，setTimeout 不會累積
    if (noCardTimer) {
        clearTimeout(noCardTimer);
        noCardTimer = null;
    }

    let cardContour = null;
    let contourToDelete = null; // 用於確保 Mat 釋放
    
    try {
        // 繪製影像到緩衝區
        canvasBufferCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        src = cv.imread(canvasBuffer);
        dst = src.clone(); 

        cardContour = detectCardBoundary(src); 
        contourToDelete = cardContour; // 預設此 Mat 應在 finally 塊中刪除
        
        const isQualityOK = cardContour && isCardStableAndClear(cardContour);

        if (cardContour && isQualityOK) { 
            // 偵測到名片且品質合格，開始穩定性檢查
            
            let currentRect = cv.minAreaRect(cardContour);
            let currentArea = cv.contourArea(cardContour);
            let isGeometricallyStable = checkGeometricStability(cardContour, currentRect, currentArea);
            // cv.RotatedRect 物件 currentRect 不需 delete()

            if (isGeometricallyStable) {
                 // *** 穩定狀態 - 綠色 ***
                 stableFrameCount++;
                 
                 lastStableRectData = { center: { x: currentRect.center.x, y: currentRect.center.y }, area: currentArea };

                 const stabilityRatio = Math.min(stableFrameCount, STABILITY_THRESHOLD) / STABILITY_THRESHOLD;
                 
                 // 顏色漸變：從黃到綠
                 const r = Math.round(100 * (1 - stabilityRatio)); 
                 const g = 255;
                 const b = 0; 
                 
                 const dynamicColor = new cv.Scalar(r, g, b, 255);
                 const dynamicThickness = Math.round(3 + 3 * stabilityRatio); 

                 drawContour(dst, cardContour, dynamicColor, dynamicThickness); 

                 statusDiv.innerHTML = `名片已鎖定！請保持**完全靜止**。穩定進度：${Math.min(stableFrameCount, STABILITY_THRESHOLD)} / ${STABILITY_THRESHOLD}`;
                 
                 if (stableFrameCount >= STABILITY_THRESHOLD) {
                    // 達到穩定門檻，自動拍照
                    autoCaptureInProgress = true; 
                    contourToDelete = null; // 責任轉移給 takeSnapshot
                    takeSnapshot(src, cardContour); 
                    return; // 停止迴圈
                 }
            } else {
                 // *** 不穩定狀態 - 橙色 ***
                 stableFrameCount = 0; 
                 
                 const normalColor = new cv.Scalar(255, 165, 0, 255); // 橙色
                 drawContour(dst, cardContour, normalColor, 3);
                 
                 statusDiv.innerHTML = '偵測到名片，但晃動或模糊。請保持靜止！';
            }
        } else {
            // 未偵測到名片或品質不合格
            stableFrameCount = 0; 
            lastStableRectData = null; 
            
            // 如果有偵測到輪廓，但品質不合格，顯示紅色警告
            if (cardContour) {
                const warningColor = new cv.Scalar(255, 0, 0, 255); // 紅色警告
                drawContour(dst, cardContour, warningColor, 2);
                statusDiv.innerHTML = '偵測到輪廓，但形狀或長寬比不符名片要求。';
                // contourToDelete = cardContour; (預設值，將在 finally 塊中刪除)
            } else {
                 contourToDelete = null; // 沒有輪廓 Mat 需要刪除
                 statusDiv.innerHTML = '請將名片置於畫面中央，背景對比度要高。'; 
            }
            
            // 啟動超時定時器
            if (!noCardTimer) {
                noCardTimer = setTimeout(handleNoCardTimeout, NO_CARD_TIMEOUT_MS);
                console.log("DIAG: 啟動無名片偵測超時定時器。");
            }
        }
        
        cv.imshow('canvasOutput', dst); 
        
        requestAnimationFrame(processVideo); 

    } catch (e) {
        console.error("DIAG ERROR: ProcessVideo 迴圈意外崩潰，正在重設：", e);
        streaming = false; 
        statusDiv.innerHTML = `錯誤：影像處理迴圈意外停止 (${e.message})。請點擊「重啟掃描」。`;
        // 錯誤發生時，顯示重試按鈕
        timeoutContainer.style.display = 'flex';
        cleanupOpenCVMats(); // 確保 src/dst 被清除
    } finally {
        // 確保 contourToDelete (Mat) 在每幀結束時被釋放，除非它被轉移給 takeSnapshot
        if (contourToDelete && !contourToDelete.isDeleted()) {
             contourToDelete.delete();
             console.log("DIAG: 輪廓 Mat 在幀結束時成功釋放。");
        }
    }
}

// 幾何穩定性檢查
function checkGeometricStability(contour, currentRect, currentArea) {
    if (!lastStableRectData) return true; // 第一次偵測到，視為穩定

    const prevCenter = lastStableRectData.center;
    const currCenter = currentRect.center;

    const centerDistance = Math.sqrt(
        Math.pow(currCenter.x - prevCenter.x, 2) + 
        Math.pow(currCenter.y - prevCenter.y, 2)
    );
    
    const areaChangeRatio = Math.abs(currentArea - lastStableRectData.area) / lastStableRectData.area;

    return centerDistance < MOVEMENT_THRESHOLD && areaChangeRatio < AREA_CHANGE_THRESHOLD;
}


// 自動拍照功能 (透視變換的核心邏輯)
function takeSnapshot(sourceMat, contour) {
    
    // 1. 停止相機串流
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    statusDiv.innerHTML = '處理中，正在進行名片裁切...';

    let srcTri = null;
    let dstTri = null;
    let M = null;
    let correctedCard = null;

    try {
        // 取得名片四個頂點並進行魯棒排序 (TL, TR, BR, BL)
        let pointsArray = [];
        for (let i = 0; i < contour.rows; ++i) {
            pointsArray.push({ x: contour.data32S[i * 2], y: contour.data32S[i * 2 + 1] });
        }
        const points_xy_sorted = [...pointsArray].sort((a, b) => (a.x + a.y) - (b.x + b.y));
        const pt_tl = points_xy_sorted[0]; 
        const pt_br = points_xy_sorted[3]; 
        const pt_mid_1 = points_xy_sorted[1];
        const pt_mid_2 = points_xy_sorted[2];
        // 確保 TR 和 BL 是正確的對角線點
        const pt_tr = pt_mid_1.x > pt_mid_2.x ? pt_mid_1 : pt_mid_2;
        const pt_bl = pt_mid_1.x < pt_mid_2.x ? pt_mid_1 : pt_mid_2;
        const finalPoints = [pt_tl, pt_tr, pt_br, pt_bl]; // TL, TR, BR, BL 順序

        srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
            finalPoints[0].x, finalPoints[0].y, finalPoints[1].x, finalPoints[1].y, 
            finalPoints[2].x, finalPoints[2].y, finalPoints[3].x, finalPoints[3].y
        ]);

        // 計算目標矩形尺寸 (使用頂點間距離，確保長寬比正確)
        let w1 = Math.sqrt(Math.pow(finalPoints[1].x - finalPoints[0].x, 2) + Math.pow(finalPoints[1].y - finalPoints[0].y, 2)); // Top Edge
        let w2 = Math.sqrt(Math.pow(finalPoints[2].x - finalPoints[3].x, 2) + Math.pow(finalPoints[2].y - finalPoints[3].y, 2)); // Bottom Edge
        let width = Math.round(Math.max(w1, w2));
        
        let h1 = Math.sqrt(Math.pow(finalPoints[3].x - finalPoints[0].x, 2) + Math.pow(finalPoints[3].y - finalPoints[0].y, 2)); // Left Edge
        let h2 = Math.sqrt(Math.pow(finalPoints[2].x - finalPoints[1].x, 2) + Math.pow(finalPoints[2].y - finalPoints[1].y, 2)); // Right Edge
        let height = Math.round(Math.max(h1, h2));

        
        if (width < 100 || height < 100) throw new Error("校正尺寸過小或無效");

        dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0, width, 0, width, height, 0, height
        ]);

        // 執行透視變換
        M = cv.getPerspectiveTransform(srcTri, dstTri);
        let dsize = new cv.Size(width, height);
        correctedCard = new cv.Mat();
        cv.warpPerspective(sourceMat, correctedCard, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

        // 顯示結果
        canvasBuffer.width = width;
        canvasBuffer.height = height; 
        cv.imshow(canvasBuffer, correctedCard); 
        snapshotImage.src = canvasBuffer.toDataURL('image/png'); 

        // 隱藏預覽 Canvas，顯示結果容器
        canvasOutput.style.display = 'none'; 
        snapshotContainer.style.display = 'flex'; 

        statusDiv.innerHTML = '自動拍攝完成，名片已精準校正。';

    } catch (error) {
        console.error("DIAG ERROR: 拍照/裁切處理失敗，正在重設：", error);
        statusDiv.innerHTML = `錯誤：名片處理失敗 (原因：${error.message})。請點擊「重新拍攝」重試。`;
        // 如果錯誤發生，我們仍然需要重設並清理
        resetAndStartCamera(); 

    } finally {
        // 釋放 Mat 記憶體
        if (srcTri) srcTri.delete();
        if (dstTri) dstTri.delete();
        if (M) M.delete();
        if (correctedCard) correctedCard.delete();
        
        // ** 必須釋放傳入的輪廓 Mat ** (因為 processVideo 已經停止)
        if(contour && !contour.isDeleted()) contour.delete();
        
        // 清理 src 和 dst (儘管它們通常在 cleanupOpenCVMats() 中處理，但這是雙重保險)
        cleanupOpenCVMats();
    }
}


// ----------------------------------------------------------------
// 輔助函式 (偵測、繪製、清理、下載、重設)
// ----------------------------------------------------------------

// 清理 OpenCV Mat 物件以避免記憶體洩漏
function cleanupOpenCVMats() {
     // 這些是每次 processVideo 迴圈開始時被替換的 Mat
     if (src && !src.isDeleted()) { src.delete(); src = null; }
     if (dst && !dst.isDeleted()) { dst.delete(); dst = null; }
}

// 重新拍攝 (從結果頁面回到預覽/偵測)
function resetAndStartCamera() {
    autoCaptureInProgress = false;
    snapshotContainer.style.display = 'none'; // 隱藏結果
    canvasOutput.style.display = 'block';     // 顯示預覽
    cleanupOpenCVMats();
    // 確保停止相機串流
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
    startCamera();
}

// 下載圖片
function downloadSnapshotImage() {
    const img = document.getElementById('snapshotImage');
    const a = document.createElement('a');
    a.href = img.src;
    a.download = 'business_card_corrected.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// 電腦視覺函式實作：偵測名片邊界
function detectCardBoundary(inputMat) {
    let gray = new cv.Mat();
    let blur = new cv.Mat();
    let canny = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
        cv.cvtColor(inputMat, gray, cv.COLOR_RGBA2GRAY, 0); 
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
        
        // 調整 Canny 邊緣檢測的閾值以獲得更好的結果
        cv.Canny(blur, canny, 50, 150, 3, false); 
        
        cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        
        let largestContour = null;
        let maxArea = 0;

        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);

            if (area < 500) { contour.delete(); continue; }
            
            let arcLength = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            
            // 近似輪廓，尋找四邊形
            cv.approxPolyDP(contour, approx, 0.02 * arcLength, true);

            // 確保找到四邊形
            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                if (largestContour) largestContour.delete();
                largestContour = approx;
            } else {
                approx.delete();
            }
            contour.delete();
        }

        return largestContour; // 返回找到的四邊形 Mat

    } catch (e) {
        console.error("DIAG ERROR: detectCardBoundary 內部錯誤:", e);
        return null;
    } finally {
        // 釋放所有臨時 Mat
        gray.delete();
        blur.delete();
        canny.delete();
        contours.delete();
        hierarchy.delete();
    }
}

// 檢查偵測到的輪廓是否符合名片的品質要求 (長寬比, 面積, 凸性)
function isCardStableAndClear(contour) {
    if (!contour) return false;
    
    let area = cv.contourArea(contour);
    let totalArea = src.cols * src.rows; 
    
    // 條件 1: 面積檢查 (5% 到 85%)
    if (area < totalArea * 0.05 || area > totalArea * 0.85) return false;

    // 條件 2: 凸性檢查
    let isConvex = cv.isContourConvex(contour);
    if (!isConvex) return false;
    
    // 條件 3: 長寬比檢查
    let rect = cv.minAreaRect(contour);
    let size = rect.size;
    let width = size.width;
    let height = size.height;

    // cv.RotatedRect 物件 rect 不需 delete()
    
    if (width < height) [width, height] = [height, width];
    
    let aspectRatio = width / height;
    // 標準名片長寬比 (1.3 - 2.5)
    if (aspectRatio < 1.3 || aspectRatio > 2.5) return false;

    return true; 
}

// 在 Mat 上繪製輪廓和頂點
function drawContour(outputMat, contour, color, thickness) {
    let contours = new cv.MatVector();
    contours.push_back(contour);

    cv.drawContours(outputMat, contours, 0, color, thickness, cv.LINE_8);
    
    // 繪製頂點以強調偵測結果
    let points = contour.data32S;
    for (let i = 0; i < points.length; i += 2) {
        let center = new cv.Point(points[i], points[i+1]);
        cv.circle(outputMat, center, thickness * 2, color, -1); 
    }
    
    contours.delete();
}

// ----------------------------------------------------------------
// 載入完成通知
// ----------------------------------------------------------------

// 腳本載入完成，設定旗標 B 並呼叫檢查函式
appLoaded = true;
console.log("DIAG: app.js 載入完成 (旗標 B 設置)。");
if (typeof checkInitialization === 'function') {
    checkInitialization();
} else {
    // 防禦性編程：如果 checkInitialization 尚未定義，則延遲檢查
    setTimeout(() => {
        if (typeof checkInitialization === 'function') {
            checkInitialization();
        }
    }, 100);
}

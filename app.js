/**
 * 名片掃描應用程式的主邏輯 (app.js) - 最終穩定版
 * 修正重點：
 * 1. 【核心修正】在 startCamera 中加入更嚴謹的錯誤處理和日誌記錄，診斷啟動失敗問題。
 * 2. 【核心修正】確保 canvasOutput 和 canvasBuffer 的尺寸與實際的 video 串流尺寸完全一致，以正確處理畫面的長寬比（例如手機上的直向模式），解決啟動無影像問題。
 * 3. 請求高解析度並啟用連續自動對焦，確保影像清晰度。
 * 4. 魯棒性增強：在 processVideo 和 takeSnapshot 中加入 try...catch 區塊。
 * 5. 【載入診斷】新增超時檢查，明確診斷 OpenCV 核心載入失敗或超時。
 */

// 宣告全域變數
let src = null; 
let dst = null; 
let streaming = false;
let canvasBuffer = null; 
let canvasBufferCtx = null; 

// 穩定性追蹤變數
let stableFrameCount = 0;
let lastStableRectData = null; // Stores {center: {x, y}, area}

// 穩定性參數
const STABILITY_THRESHOLD = 30; // 需要連續 30 幀 (約 1 秒) 保持幾何穩定
const MOVEMENT_THRESHOLD = 15; // 允許的最大中心點移動距離 (像素)
const AREA_CHANGE_THRESHOLD = 0.1; // 允許的最大面積變化比例 (10%)


// 新增 DOM 元素參照
let snapshotContainer = null;
let snapshotImage = null;
let downloadSnapshot = null;
let retakeButton = null;

// 取得 DOM 元素參照
const video = document.getElementById('video');
const canvasOutput = document.getElementById('canvasOutput');
const statusDiv = document.getElementById('status');
const startButton = document.getElementById('startButton'); 
canvasBuffer = document.getElementById('canvasBuffer');

// 新增 DOM 元素參照
snapshotContainer = document.getElementById('snapshotContainer');
snapshotImage = document.getElementById('snapshotImage');
downloadSnapshot = document.getElementById('downloadSnapshot');
retakeButton = document.getElementById('retakeButton');

let opencvLoadTimeout; // 載入超時檢查器

// ** 核心修正：定義全域 Module 物件，以避免 ReferenceError **
var Module = {
    onRuntimeInitialized: function() {
        clearTimeout(opencvLoadTimeout); // 成功載入，清除超時
        statusDiv.innerHTML = 'OpenCV 載入完成。請點擊「開始」按鈕。';
        console.log("DIAG: Module.onRuntimeInitialized 成功，OpenCV 核心已準備就緒。");
        
        if (startButton) {
            startButton.addEventListener('click', startCamera);
            startButton.disabled = false;
            startButton.innerHTML = '點擊開始';
        }

        // 初始化拍照結果顯示區域的事件監聽器 (強化下載邏輯)
        if (downloadSnapshot) {
            downloadSnapshot.addEventListener('click', () => {
                const img = document.getElementById('snapshotImage');
                const tempCanvas = document.createElement('canvas');
                
                // 嘗試從 img 標籤獲取實際尺寸
                tempCanvas.width = img.naturalWidth || 1280;
                tempCanvas.height = img.naturalHeight || 720;
                const tempCtx = tempCanvas.getContext('2d');
                
                if (!img.src || img.naturalWidth === 0) {
                    statusDiv.innerHTML = '無法下載：圖片數據不存在。請重新拍攝。';
                    console.error('無法下載：圖片數據不存在。');
                    return;
                }
                
                tempCtx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);

                const a = document.createElement('a');
                a.href = tempCanvas.toDataURL('image/png');
                a.download = 'business_card_corrected.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });
        }
        if (retakeButton) {
            retakeButton.addEventListener('click', resetAndStartCamera);
        }
    }
};


// ** 新增 DOM 檢查和初始狀態設定 **
if (startButton && canvasBuffer && snapshotContainer && snapshotImage && downloadSnapshot && retakeButton) {
    startButton.innerHTML = 'OpenCV 載入中...';
    startButton.disabled = true; 

    // 【載入診斷】設定超時檢查 (15 秒)
    opencvLoadTimeout = setTimeout(() => {
        if (startButton.innerHTML === 'OpenCV 載入中...') {
            statusDiv.innerHTML = '錯誤：OpenCV 載入超時 (15 秒)。請檢查網路連線或嘗試重新整理。';
            console.error("DIAG ERROR: OpenCV.js 載入超時。可能因為網路問題。");
        }
    }, 15000); // 15 秒超時
    
} else {
    statusDiv.innerHTML = '致命錯誤：找不到必要的 DOM 元素。請確認 index.html 已更新！';
    console.error("DIAG ERROR: Missing critical DOM elements. Check index.html.");
}

// 重設並重新啟動相機 (用於重新拍攝)
function resetAndStartCamera() {
    // 停止相機串流
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        console.log("DIAG: resetAndStartCamera - 成功停止相機軌道。");
    }
    
    // 顯式清理 Mat 物件
    if (src && !src.isDeleted()) {
        src.delete(); 
        src = null;
    }
    if (dst && !dst.isDeleted()) {
        dst.delete();
        dst = null;
    }

    streaming = false; // 確保處理迴圈停止
    
    // 調整 UI 顯示
    snapshotContainer.style.display = 'none'; // 隱藏結果
    canvasOutput.style.display = 'block';     // 顯示預覽
    startButton.style.display = 'block';      // 顯示開始按鈕
    statusDiv.innerHTML = '點擊「開始」重新拍攝。';
    
    // 重設穩定性狀態
    stableFrameCount = 0; 
    lastStableRectData = null; 
}

// 2. 啟動相機並設定串流 
function startCamera() {
    startButton.style.display = 'none'; // 隱藏開始按鈕
    canvasOutput.style.display = 'block'; // 確保 Canvas 預覽顯示
    statusDiv.innerHTML = '正在請求相機權限...';
    
    // 請求高解析度並啟用連續對焦 (確保影像清晰度)
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment',
            width: { ideal: 1280 }, // 請求高寬度以提高影像品質
            height: { ideal: 720 }, // 請求高高度以提高影像品質
            focusMode: "continuous" // 嘗試強制連續自動對焦 (iOS 上可能只支持 'auto')
        }
    })
    .then(stream => {
        video.srcObject = stream;
        
        console.log("DIAG: getUserMedia 成功取得串流。等待 loadeddata 事件...");
        
        video.addEventListener('loadeddata', function initializeVideoAndStartLoop() {
            video.removeEventListener('loadeddata', initializeVideoAndStartLoop);

            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            console.log(`DIAG: loadeddata 事件觸發。串流解析度: ${videoWidth}x${videoHeight}`);
            
            if (videoWidth === 0 || videoHeight === 0) {
                 const errMsg = '致命錯誤：串流尺寸為 0x0。請重新整理或檢查相機資源是否被佔用。';
                 statusDiv.innerHTML = errMsg;
                 startButton.style.display = 'block'; 
                 // 嘗試停止串流以釋放資源
                 if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); }
                 return;
            }

            // 【修正】確保 Canvas 尺寸與影片串流尺寸完全一致
            canvasOutput.width = canvasBuffer.width = videoWidth;
            canvasOutput.height = canvasBuffer.height = videoHeight;
            
            canvasBufferCtx = canvasBuffer.getContext('2d');
            
            video.play().then(() => {
                // 檢查實際獲取的解析度
                const track = stream.getVideoTracks()[0];
                const settings = track.getSettings();
                console.log(`DIAG: 實際解析度: ${settings.width}x${settings.height}, 對焦模式: ${settings.focusMode}`);
                
                statusDiv.innerHTML = '影像串流啟動成功，請將名片置於畫面中央。';
                console.log("DIAG: video.play() 成功。準備進入處理迴圈...");
                
                streaming = true;
                processVideo(); 
                
            }).catch(e => {
                const errMsg = `錯誤：影像播放失敗。請檢查錯誤碼或權限: ${e.message || e.name}`;
                statusDiv.innerHTML = errMsg;
                console.error("DIAG ERROR: 影像播放失敗:", e);
                startButton.style.display = 'block';
            });
        });
    })
    .catch(err => {
        const errMsg = `錯誤：無法存取相機。請檢查權限是否被拒絕。(Error: ${err.name} - ${err.message})`;
        statusDiv.innerHTML = errMsg;
        console.error("DIAG ERROR: 無法存取相機:", err);
        startButton.style.display = 'block'; 
    });
}

// 3. 影像處理迴圈 (核心邏輯) 
function processVideo() {
    if (!streaming) return;

    try {
        if (src && !src.isDeleted()) {
            src.delete(); 
        }
        if (dst && !dst.isDeleted()) {
            dst.delete();
        }
        
        // 繪製影像到緩衝區
        canvasBufferCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        src = cv.imread(canvasBuffer);
        dst = src.clone(); 

        let cardContour = detectCardBoundary(src); 
        
        const isQualityOK = cardContour && isCardStableAndClear(cardContour);

        if (isQualityOK) {
            let currentRect = cv.minAreaRect(cardContour);
            let currentArea = cv.contourArea(cardContour);
            let isGeometricallyStable = false;

            if (lastStableRectData) {
                // 幾何穩定性比較
                const prevCenter = lastStableRectData.center;
                const currCenter = currentRect.center;

                const centerDistance = Math.sqrt(
                    Math.pow(currCenter.x - prevCenter.x, 2) + 
                    Math.pow(currCenter.y - prevCenter.y, 2)
                );
                
                const areaChangeRatio = Math.abs(currentArea - lastStableRectData.area) / lastStableRectData.area;

                if (centerDistance < MOVEMENT_THRESHOLD && areaChangeRatio < AREA_CHANGE_THRESHOLD) {
                    isGeometricallyStable = true;
                }
            } else {
                isGeometricallyStable = true;
            }
            
            if (isGeometricallyStable) {
                 stableFrameCount++;
                 
                 lastStableRectData = {
                     center: { x: currentRect.center.x, y: currentRect.center.y },
                     area: currentArea
                 };

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
                    // 達到穩定門檻，拍照
                    takeSnapshot(src, cardContour); 
                 }
                 dynamicColor.delete(); 
            } else {
                 stableFrameCount = 0; 
                 
                 const normalColor = new cv.Scalar(255, 165, 0, 255); // 橙色
                 drawContour(dst, cardContour, normalColor, 3);
                 normalColor.delete();

                 statusDiv.innerHTML = '偵測到物體，但移動或抖動過大。請保持靜止！';
            }
            currentRect.delete(); 
            cardContour.delete(); 
        } else {
            // 沒有輪廓或輪廓品質不佳
            stableFrameCount = 0; 
            lastStableRectData = null; 
            
            if (cardContour && !isCardStableAndClear(cardContour)) {
                 cardContour.delete();
                 statusDiv.innerHTML = '偵測到輪廓，但形狀或長寬比不符名片要求。';
            } else {
                 statusDiv.innerHTML = '請將名片置於畫面中央，背景對比度要高。'; 
            }
        }
        
        cv.imshow('canvasOutput', dst); 
        
        requestAnimationFrame(processVideo); 

    } catch (e) {
        console.error("DIAG ERROR: ProcessVideo 迴圈意外崩潰，正在重設：", e);
        streaming = false; 
        statusDiv.innerHTML = `錯誤：影像處理迴圈意外停止 (${e.message})。請點擊「開始」重試。`;
        resetAndStartCamera(); 
    }
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
        
        // Canny 門檻 (維持上次修正)
        cv.Canny(blur, canny, 50, 150, 3, false); 
        
        cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        
        let largestContour = null;
        let maxArea = 0;

        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);

            // 最小面積要求 (維持上次修正)
            if (area < 500) continue; 
            
            let arcLength = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            
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

        return largestContour;

    } catch (e) {
        console.error("DIAG ERROR: detectCardBoundary 內部錯誤:", e);
        return null;
    } finally {
        gray.delete();
        blur.delete();
        canny.delete();
        contours.delete();
        hierarchy.delete();
    }
}

// 判斷名片是否穩定和清晰的簡單邏輯 (無變動)
function isCardStableAndClear(contour) {
    if (!contour) return false;
    
    let area = cv.contourArea(contour);
    let totalArea = src.cols * src.rows; 
    
    // 條件 1: 面積檢查 (5% 到 85%)
    if (area < totalArea * 0.05 || area > totalArea * 0.85) { 
        return false;
    }

    // 條件 2: 凸性檢查
    let isConvex = cv.isContourConvex(contour);
    if (!isConvex) {
        return false;
    }
    
    // 條件 3: 長寬比檢查
    let rect = cv.minAreaRect(contour);
    let size = rect.size;
    let width = size.width;
    let height = size.height;

    rect.delete(); 

    if (width < height) {
        [width, height] = [height, width];
    }
    
    let aspectRatio = width / height;
    if (aspectRatio < 1.3 || aspectRatio > 2.5) { 
        return false;
    }

    return true; 
}

// 在影像上繪製輪廓
function drawContour(outputMat, contour, color, thickness) {
    let contours = new cv.MatVector();
    contours.push_back(contour);

    cv.drawContours(outputMat, contours, 0, color, thickness, cv.LINE_8);
    
    let points = contour.data32S;
    for (let i = 0; i < points.length; i += 2) {
        let center = new cv.Point(points[i], points[i+1]);
        cv.circle(outputMat, center, thickness * 2, color, -1); 
    }
    
    contours.delete();
}

// 拍照功能 (透視變換的核心邏輯)
function takeSnapshot(sourceMat, contour) {
    // 1. 立即停止串流並更新狀態 (確保資源釋放)
    streaming = false;
    statusDiv.innerHTML = '處理中，請稍候...';
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    let srcTri = null;
    let dstTri = null;
    let M = null;
    let correctedCard = null;

    try {
        // 1. 取得名片四個頂點並進行魯棒排序
        let pointsArray = [];
        for (let i = 0; i < contour.rows; ++i) {
            pointsArray.push({
                x: contour.data32S[i * 2],
                y: contour.data32S[i * 2 + 1]
            });
        }
        
        // 魯棒排序方法：確保點的順序為：TL, TR, BR, BL
        const points_xy_sorted = [...pointsArray].sort((a, b) => (a.x + a.x) - (b.x + b.y)); // x+y 總和排序
        const pt_tl = points_xy_sorted[0]; 
        const pt_br = points_xy_sorted[3]; 

        const pt_mid_1 = points_xy_sorted[1];
        const pt_mid_2 = points_xy_sorted[2];

        // 根據 x 座標區分 TR 和 BL
        const pt_tr = pt_mid_1.x > pt_mid_2.x ? pt_mid_1 : pt_mid_2;
        const pt_bl = pt_mid_1.x < pt_mid_2.x ? pt_mid_1 : pt_mid_2;

        const finalPoints = [pt_tl, pt_tr, pt_br, pt_bl];

        // 2. 準備透視變換的來源和目標點
        srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
            finalPoints[0].x, finalPoints[0].y, // TL
            finalPoints[1].x, finalPoints[1].y, // TR
            finalPoints[2].x, finalPoints[2].y, // BR
            finalPoints[3].x, finalPoints[3].y  // BL
        ]);

        // 計算名片校正後的大小
        let width = Math.sqrt(Math.pow(pt_tr.x - pt_tl.x, 2) + Math.pow(pt_tr.y - pt_tl.y, 2));
        let height = Math.sqrt(Math.pow(pt_bl.x - pt_tl.x, 2) + Math.pow(pt_bl.y - pt_tl.y, 2));
        
        width = Math.round(width);
        height = Math.round(height);

        if (width < 100 || height < 100) {
            throw new Error("校正尺寸過小或無效 (W:" + width + " H:" + height + ")");
        }


        // 目標矩形點 (校正後的影像會變成這個大小)
        dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0,
            width, 0,
            width, height,
            0, height
        ]);

        // 3. 執行透視變換
        M = cv.getPerspectiveTransform(srcTri, dstTri);
        let dsize = new cv.Size(width, height);
        correctedCard = new cv.Mat();
        cv.warpPerspective(sourceMat, correctedCard, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

        // 4. 將校正後的圖片顯示到 img 標籤
        cv.imshow(snapshotImage, correctedCard);

        // 隱藏預覽 Canvas，顯示結果
        canvasOutput.style.display = 'none';
        snapshotContainer.style.display = 'flex'; // 使用 flex 讓內容居中

        statusDiv.innerHTML = '拍攝完成，已自動校正。';
        console.log("DIAG: 快照已拍攝，透視變換完成並顯示。");


    } catch (error) {
        console.error("DIAG ERROR: 拍照處理失敗，正在重設：", error);
        
        statusDiv.innerHTML = `錯誤：名片處理失敗 (原因：${error.message})。請重試並確認名片邊緣清晰。`;
        
        resetAndStartCamera(); 

    } finally {
        // 釋放記憶體
        if (srcTri && !srcTri.isDeleted()) srcTri.delete();
        if (dstTri && !dstTri.isDeleted()) dstTri.delete();
        if (M && !M.isDeleted()) M.delete();
        if (correctedCard && !correctedCard.isDeleted()) correctedCard.delete();
    }
}

/**
 * 名片掃描應用程式的主邏輯 (app.js) - 最終穩定版
 * 實現完整的自動拍照流程，包括透視變換和結果顯示。
 */

// 宣告全域變數
let src = null; 
let dst = null; 
let streaming = false;
let greenColor; 
let canvasBuffer = null; 
let canvasBufferCtx = null; 

// 新增 DOM 元素參照
let snapshotContainer = null;
let snapshotImage = null;
let downloadSnapshot = null;
let retakeButton = null;

// ** 核心修正：定義全域 Module 物件，以避免 ReferenceError **
var Module = {
    onRuntimeInitialized: function() {
        greenColor = new cv.Scalar(0, 255, 0, 255);
        
        statusDiv.innerHTML = 'OpenCV 載入完成。請點擊「開始」按鈕。';
        console.log("DIAG: Module.onRuntimeInitialized 成功，OpenCV 核心已準備就緒。");
        
        if (startButton) {
            startButton.addEventListener('click', startCamera);
            startButton.disabled = false;
            startButton.innerHTML = '點擊開始';
        }

        // 初始化拍照結果顯示區域的事件監聽器
        if (downloadSnapshot) {
            downloadSnapshot.addEventListener('click', () => {
                const img = document.getElementById('snapshotImage');
                const a = document.createElement('a');
                a.href = img.src;
                a.download = 'business_card.png';
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


// ** 新增 DOM 檢查和初始狀態設定 **
if (startButton && canvasBuffer && snapshotContainer && snapshotImage && downloadSnapshot && retakeButton) {
    startButton.innerHTML = 'OpenCV 載入中...';
    startButton.disabled = true; 
} else {
    statusDiv.innerHTML = '致命錯誤：找不到必要的 DOM 元素。請確認 index.html 已更新！';
    console.error("DIAG ERROR: Missing critical DOM elements. Check index.html.");
}

// 重設並重新啟動相機 (用於重新拍攝)
function resetAndStartCamera() {
    snapshotContainer.style.display = 'none'; // 隱藏結果
    canvasOutput.style.display = 'block';     // 顯示預覽
    startButton.style.display = 'block';      // 顯示開始按鈕
    statusDiv.innerHTML = '點擊「開始」重新拍攝。';
}

// 2. 啟動相機並設定串流
function startCamera() {
    startButton.style.display = 'none'; // 隱藏開始按鈕
    canvasOutput.style.display = 'block'; // 確保 Canvas 預覽顯示
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

            console.log(`DIAG: loadeddata 事件觸發。串流解析度: ${video.videoWidth}x${video.videoHeight}`);

            if (video.videoWidth === 0 || video.videoHeight === 0) {
                 const errMsg = '致命錯誤：串流尺寸為 0x0。請重新整理或檢查相機資源是否被佔用。';
                 statusDiv.innerHTML = errMsg;
                 startButton.style.display = 'block'; // 顯示開始按鈕讓用戶重試
                 return;
            }

            canvasOutput.width = canvasBuffer.width = video.videoWidth;
            canvasOutput.height = canvasBuffer.height = video.videoHeight;
            
            canvasBufferCtx = canvasBuffer.getContext('2d');
            
            video.play().then(() => {
                statusDiv.innerHTML = '影像串流啟動成功，開始處理...';
                console.log("DIAG: video.play() 成功。準備進入處理迴圈...");
                
                streaming = true;
                processVideo(); 
                
            }).catch(e => {
                const errMsg = `錯誤：影像播放失敗。請檢查錯誤碼: ${e.message || e.name}`;
                statusDiv.innerHTML = errMsg;
                startButton.style.display = 'block'; // 顯示開始按鈕讓用戶重試
            });
        });
    })
    .catch(err => {
        const errMsg = `錯誤：無法存取相機。請檢查權限是否被拒絕。(Error: ${err.name} - ${err.message})`;
        statusDiv.innerHTML = errMsg;
        console.error("DIAG ERROR: 無法存取相機:", err);
        startButton.style.display = 'block'; // 顯示開始按鈕讓用戶重試
    });
}

// 3. 影像處理迴圈 (核心邏輯) 
function processVideo() {
    if (!streaming) return;

    if (src && !src.isDeleted()) {
        src.delete(); 
    }
    if (dst && !dst.isDeleted()) {
        dst.delete();
    }
    
    canvasBufferCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    src = cv.imread(canvasBuffer);
    dst = src.clone(); 

    let cardContour = detectCardBoundary(src); 

    if (cardContour) {
        drawContour(dst, cardContour); 

        if (isCardStableAndClear(cardContour)) {
             statusDiv.innerHTML = '名片已鎖定！準備自動拍攝...';
             takeSnapshot(src, cardContour); 
        } else {
             statusDiv.innerHTML = '偵測到物體，但仍在調整對焦與角度。';
        }
        cardContour.delete(); 
    } else {
        statusDiv.innerHTML = '請將名片置於畫面中央。';
    }
    
    cv.imshow('canvasOutput', dst); 
    
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

            if (area < 1000) continue; 

            let arcLength = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            
            cv.approxPolyDP(contour, approx, 0.02 * arcLength, true);

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
        return null;
    } finally {
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
function drawContour(outputMat, contour) {
    let contours = new cv.MatVector();
    contours.push_back(contour);

    cv.drawContours(outputMat, contours, 0, greenColor, 5, cv.LINE_8);
    
    let points = contour.data32S;
    for (let i = 0; i < points.length; i += 2) {
        let center = new cv.Point(points[i], points[i+1]);
        cv.circle(outputMat, center, 10, greenColor, -1); 
    }
    
    contours.delete();
}

// 拍照功能 (實現透視變換和圖片導出)
function takeSnapshot(sourceMat, contour) {
    // 停止串流
    streaming = false;
    statusDiv.innerHTML = '處理中，請稍候...';

    // 1. 取得名片四個頂點 (左上、右上、右下、左下)
    let approxPoints = [];
    for (let i = 0; i < contour.rows; ++i) {
        approxPoints.push(new cv.Point(contour.data32S[i * 2], contour.data32S[i * 2 + 1]));
    }
    // 根據X,Y座標排序，確保順序為左上、右上、右下、左下 (OpenCV需要)
    approxPoints.sort((a, b) => a.y - b.y);
    let topLeft = approxPoints[0].x < approxPoints[1].x ? approxPoints[0] : approxPoints[1];
    let topRight = approxPoints[0].x > approxPoints[1].x ? approxPoints[0] : approxPoints[1];
    let bottomRight = approxPoints[2].x > approxPoints[3].x ? approxPoints[2] : approxPoints[3];
    let bottomLeft = approxPoints[2].x < approxPoints[3].x ? approxPoints[2] : approxPoints[3];

    // 2. 準備透視變換的來源和目標點
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        topLeft.x, topLeft.y,
        topRight.x, topRight.y,
        bottomRight.x, bottomRight.y,
        bottomLeft.x, bottomLeft.y
    ]);

    // 計算名片校正後的大小 (基於原始輪廓的長寬)
    let width = Math.sqrt(Math.pow(topRight.x - topLeft.x, 2) + Math.pow(topRight.y - topLeft.y, 2));
    let height = Math.sqrt(Math.pow(bottomLeft.x - topLeft.x, 2) + Math.pow(bottomLeft.y - topLeft.y, 2));

    // 目標矩形點 (校正後的影像會變成這個大小)
    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        width, 0,
        width, height,
        0, height
    ]);

    // 3. 執行透視變換
    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    let dsize = new cv.Size(width, height);
    let correctedCard = new cv.Mat();
    cv.warpPerspective(sourceMat, correctedCard, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // 4. 將校正後的圖片顯示到 img 標籤
    cv.imshow(snapshotImage, correctedCard);

    // 釋放記憶體
    srcTri.delete();
    dstTri.delete();
    M.delete();
    correctedCard.delete();

    // 隱藏預覽 Canvas，顯示結果
    canvasOutput.style.display = 'none';
    snapshotContainer.style.display = 'block';

    statusDiv.innerHTML = '拍攝完成，已自動校正。';
    console.log("快照已拍攝，透視變換完成並顯示。");

    // 停止相機串流 (真正停止硬體)
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
}

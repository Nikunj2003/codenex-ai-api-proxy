/**
 * Image click zoom functionality module
 */

export function initImageZoom() {
    // Create zoom overlay
    const overlay = document.createElement('div');
    overlay.className = 'image-zoom-overlay';
    overlay.innerHTML = '<img src="" alt="Zoomed Image">';
    document.body.appendChild(overlay);

    const zoomedImg = overlay.querySelector('img');

    // Listen for click events
    document.addEventListener('click', (e) => {
        const target = e.target;

        // If clicked on a zoomable QR code
        if (target.classList.contains('clickable-qr')) {
            zoomedImg.src = target.src;
            overlay.style.display = 'flex';
            setTimeout(() => {
                overlay.classList.add('show');
            }, 10);
        }

        // If clicked on the overlay (or the image inside), close it
        if (overlay.classList.contains('show') && (target === overlay || target === zoomedImg)) {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 300);
        }
    });

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('show')) {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 300);
        }
    });
}

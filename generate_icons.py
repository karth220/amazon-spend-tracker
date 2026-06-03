import os
import sys

# Ensure Pillow is installed
try:
    from PIL import Image, ImageDraw
except ImportError:
    import subprocess
    print("Pillow not found. Installing...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"])
        from PIL import Image, ImageDraw
    except Exception as e:
        print(f"Failed to install pillow automatically: {e}")
        print("Creating fallback icons using basic file operations if possible...")
        sys.exit(1)

# Ensure icons directory exists
os.makedirs('icons', exist_ok=True)

def create_icon(size, filename):
    # Amazon Orange: RGB(255, 153, 0)
    img = Image.new('RGBA', (size, size), color=(255, 153, 0, 255))
    draw = ImageDraw.Draw(img)
    
    # Draw a white circle outline
    margin = max(1, size // 8)
    border_width = max(1, size // 16)
    draw.ellipse(
        [margin, margin, size - margin, size - margin], 
        outline=(255, 255, 255, 255), 
        width=border_width
    )
    
    # Draw a simple white vertical line for currency/spends representation
    draw.line(
        [size // 2, margin * 2, size // 2, size - margin * 2], 
        fill=(255, 255, 255, 255), 
        width=border_width
    )
    
    # Draw a horizontal line crossing it (making a simple currency / center mark)
    draw.line(
        [size // 3, size // 2, size - size // 3, size // 2], 
        fill=(255, 255, 255, 255), 
        width=border_width
    )

    img.save(filename)
    print(f"Created {filename}")

if __name__ == '__main__':
    create_icon(16, 'icons/icon16.png')
    create_icon(48, 'icons/icon48.png')
    create_icon(128, 'icons/icon128.png')
    print("Icon generation completed successfully.")

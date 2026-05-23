import zipfile
import os

def zip_folder(folder_path, output_path):
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(folder_path):
            for file in files:
                file_path = os.path.join(root, file)
                # Compute relative path and replace backslashes with forward slashes
                arc_name = os.path.relpath(file_path, start=os.path.dirname(folder_path))
                arc_name = arc_name.replace('\\', '/')
                zipf.write(file_path, arc_name)
    print(f"Successfully zipped {folder_path} to {output_path} with forward slashes.")

if __name__ == '__main__':
    zip_folder('dist', 'dist_clean.zip')

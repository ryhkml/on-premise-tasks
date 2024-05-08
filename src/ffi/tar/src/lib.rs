use std::{
	ffi::CStr,
	fs::File,
	io::{self},
	os::raw::c_char,
	path::Path,
};
use flate2::{
	write::GzEncoder, Compression,
};
use tar::Builder;

#[no_mangle]
pub extern "C" fn compress_dir(dir_path: *const c_char, output_path: *const c_char) -> u8 {
    let dir_path = unsafe { CStr::from_ptr(dir_path) };
    let output_path = unsafe { CStr::from_ptr(output_path) };
    let dir_path_str = match dir_path.to_str() {
        Ok(s) => s,
        Err(_) => return 0,
    };
    let output_path_str = match output_path.to_str() {
        Ok(s) => s,
        Err(_) => return 0,
    };
    match compress_to_tar_gz(Path::new(dir_path_str), Path::new(output_path_str)) {
        Ok(_) => 1,
        Err(_) => 0,
    }
}

fn compress_to_tar_gz<P: AsRef<Path>>(dir_path: P, output_tar_gz_path: P) -> io::Result<()> {
    let tar_gz_file = File::create(output_tar_gz_path)?;
    let tar_gz = GzEncoder::new(tar_gz_file, Compression::default());
    let mut tarball = Builder::new(tar_gz);
    add_to_tarball(&mut tarball, dir_path.as_ref(), Path::new(""))?;
    tarball.into_inner()?.finish()?;
    Ok(())
}

fn add_to_tarball(builder: &mut Builder<GzEncoder<File>>, path: &Path, base_path: &Path) -> io::Result<()> {
	let metadata = std::fs::metadata(path)?;
	if metadata.is_file() {
		let mut file = File::open(path)?;
		builder.append_file(base_path, &mut file)?;
	} else if metadata.is_dir() {
		for entry in std::fs::read_dir(path)? {
			let entry = entry?;
			let path = entry.path();
			let new_base = base_path.join(entry.file_name());
			add_to_tarball(builder, &path, &new_base)?;
		}
	}
	Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use tempfile::tempdir;

    #[test]
    fn test_compress_to_tar_gz() {
        let dir = tempdir().unwrap();
        let file1_path = dir.path().join("db1.db");
        let file2_path = dir.path().join("subdb").join("db2.db");
        fs::create_dir_all(file2_path.parent().unwrap()).unwrap();
        File::create(file1_path).unwrap();
        File::create(file2_path).unwrap();
        let output_file = dir.path().join("db.bak.tar.gz");
        let result = compress_to_tar_gz(dir.path(), &output_file);
        assert!(result.is_ok(), "Compression failed");
        assert!(output_file.exists(), "Output file not found");
    }
}
"""
Binary Resolver Utility

Shared utility for finding bundled or system binaries with consistent priority:
1. Bundled binary in plugin bin/ directory (for plugin distributions)
2. System PATH (for user/system-wide installations)
3. User's ~/.local/bin/ (for pip install --user)
"""
import os
import logging
import shutil
from typing import Optional

logger = logging.getLogger(__name__)


def find_binary(
    binary_name: str,
    plugin_dir: Optional[str] = None,
    log_prefix: str = "",
    not_found_help: Optional[str] = None
) -> Optional[str]:
    """
    Find binary with priority: bundled -> system PATH -> ~/.local/bin
    
    Args:
        binary_name: Name of the binary to find (e.g., 'legendary', 'nile')
        plugin_dir: Plugin directory path for checking bundled binaries
        log_prefix: Prefix for log messages (e.g., '[EPIC]', '[Amazon]')
        not_found_help: Optional help message to show if binary is not found
    
    Returns:
        Path to binary if found, None otherwise
    """
    # Priority 1: Check bundled binary in plugin bin/ directory
    if plugin_dir:
        bundled_binary = os.path.join(plugin_dir, 'bin', binary_name)
        if os.path.isfile(bundled_binary) and os.access(bundled_binary, os.X_OK):
            logger.info(f"{log_prefix} Using bundled {binary_name}: {bundled_binary}")
            return bundled_binary

    # Priority 2: Check system PATH
    system_path = shutil.which(binary_name)
    if system_path:
        logger.info(f"{log_prefix} Using system {binary_name}: {system_path}")
        return system_path

    # Priority 3: Check ~/.local/bin explicitly
    local_bin_path = os.path.expanduser(f"~/.local/bin/{binary_name}")
    if os.path.exists(local_bin_path):
        logger.info(f"{log_prefix} Using user {binary_name}: {local_bin_path}")
        return local_bin_path

    # Not found
    logger.warning(f"{log_prefix} {binary_name} not found")
    if not_found_help:
        logger.info(f"{log_prefix} {not_found_help}")
    
    return None

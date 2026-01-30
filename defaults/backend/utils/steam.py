"""
Steam utility functions - consolidated Steam path and user detection.

This module provides centralized Steam-related utilities to avoid duplication
across multiple files (main.py, steam_user_utils.py, steamgriddb_client.py).
"""
import os
import logging
from typing import Optional
from pathlib import Path


logger = logging.getLogger(__name__)


def find_steam_path() -> Optional[str]:
    """
    Find Steam installation directory.
    
    Checks common Steam installation locations and returns the first valid path found.
    
    Returns:
        Path to Steam installation directory, or None if not found.
    """
    possible_paths = [
        os.path.expanduser("~/.steam/steam"),
        os.path.expanduser("~/.local/share/Steam"),
    ]

    for path in possible_paths:
        if os.path.exists(os.path.join(path, "steamapps")):
            logger.debug(f"Found Steam at: {path}")
            return path

    logger.warning("Steam installation not found")
    return None


def find_steam_grid_path(steam_path: Optional[str] = None) -> Optional[str]:
    """
    Find Steam grid artwork directory.
    
    Args:
        steam_path: Optional Steam installation path. If not provided, will auto-detect.
        
    Returns:
        Path to Steam grid directory, or None if not found.
    """
    if not steam_path:
        steam_path = find_steam_path()
    
    if not steam_path:
        return None
    
    grid_path = os.path.join(steam_path, "userdata")
    if os.path.exists(grid_path):
        return grid_path
    
    return None


def get_steam_userdata_path(steam_path: Optional[str] = None) -> Optional[str]:
    """
    Get Steam userdata directory path.
    
    Args:
        steam_path: Optional Steam installation path. If not provided, will auto-detect.
        
    Returns:
        Path to userdata directory, or None if not found.
    """
    if not steam_path:
        steam_path = find_steam_path()
    
    if not steam_path:
        return None
    
    userdata_path = os.path.join(steam_path, "userdata")
    return userdata_path if os.path.exists(userdata_path) else None

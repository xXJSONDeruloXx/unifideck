"""
Cache repository - provides unified JSON cache management.

This module eliminates duplication by providing a single, reusable cache
implementation for all JSON-based caches in the application.
"""
import json
import logging
import time
from pathlib import Path
from typing import Dict, Any, Optional, TypeVar, Generic


logger = logging.getLogger(__name__)

T = TypeVar('T')


class JSONCache(Generic[T]):
    """
    Generic JSON cache with optional in-memory caching and TTL support.
    
    Provides thread-safe (async-safe) caching with:
    - Persistent JSON storage in ~/.local/share/unifideck/
    - Optional in-memory caching with TTL
    - Automatic directory creation
    - Comprehensive error handling
    """
    
    def __init__(self, filename: str, ttl: float = 0, base_dir: Optional[str] = None):
        """
        Initialize JSON cache.
        
        Args:
            filename: Name of the JSON file (e.g., 'game_sizes.json')
            ttl: Time-to-live for in-memory cache in seconds. 0 = no in-memory cache
            base_dir: Base directory path. Defaults to ~/.local/share/unifideck
        """
        if base_dir:
            self.path = Path(base_dir) / filename
        else:
            self.path = Path.home() / ".local" / "share" / "unifideck" / filename
        
        self.ttl = ttl
        self._mem_cache: Optional[T] = None
        self._mem_cache_time: float = 0
        
        logger.debug(f"[Cache] Initialized {filename} (TTL: {ttl}s)")
    
    def load(self, default: Optional[T] = None) -> T:
        """
        Load cache from disk, using in-memory cache if available and not expired.
        
        Args:
            default: Default value to return if cache doesn't exist or fails to load
            
        Returns:
            Cached data or default value
        """
        # Check in-memory cache first (if TTL is configured)
        if self.ttl > 0:
            now = time.time()
            if self._mem_cache is not None and (now - self._mem_cache_time) < self.ttl:
                logger.debug(f"[Cache] Memory hit: {self.path.name}")
                return self._mem_cache
        
        # Cache miss - read from disk
        try:
            if self.path.exists():
                with open(self.path, 'r') as f:
                    data = json.load(f)
                    
                # Update in-memory cache
                if self.ttl > 0:
                    self._mem_cache = data
                    self._mem_cache_time = time.time()
                    logger.debug(f"[Cache] Loaded from disk: {self.path.name}")
                
                return data
        except Exception as e:
            logger.error(f"[Cache] Error loading {self.path.name}: {e}")
        
        return default if default is not None else {}
    
    def save(self, data: T) -> bool:
        """
        Save cache to disk and update in-memory cache.
        
        Args:
            data: Data to save
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Ensure directory exists
            self.path.parent.mkdir(parents=True, exist_ok=True)
            
            # Write to disk
            with open(self.path, 'w') as f:
                json.dump(data, f, indent=2)
            
            # Update in-memory cache
            if self.ttl > 0:
                self._mem_cache = data
                self._mem_cache_time = time.time()
            
            logger.debug(f"[Cache] Saved {self.path.name}")
            return True
            
        except Exception as e:
            logger.error(f"[Cache] Error saving {self.path.name}: {e}")
            self.invalidate()
            return False
    
    def invalidate(self) -> None:
        """Invalidate in-memory cache, forcing next load to read from disk."""
        if self.ttl > 0:
            self._mem_cache = None
            self._mem_cache_time = 0
            logger.debug(f"[Cache] Invalidated: {self.path.name}")
    
    def delete(self) -> bool:
        """
        Delete cache file from disk and clear memory.
        
        Returns:
            True if successful or file didn't exist, False on error
        """
        try:
            if self.path.exists():
                self.path.unlink()
                logger.info(f"[Cache] Deleted: {self.path.name}")
            
            self.invalidate()
            return True
            
        except Exception as e:
            logger.error(f"[Cache] Error deleting {self.path.name}: {e}")
            return False
    
    def exists(self) -> bool:
        """Check if cache file exists on disk."""
        return self.path.exists()
    
    def get_path(self) -> Path:
        """Get the full path to the cache file."""
        return self.path


# Pre-configured cache instances for common use cases
steam_appid_cache = JSONCache[Dict[int, int]]("steam_appid_cache.json")
shortcuts_registry_cache = JSONCache[Dict[str, Dict]]("shortcuts_registry.json")
game_sizes_cache = JSONCache[Dict[str, Dict]]("game_sizes.json", ttl=60.0)
compat_cache = JSONCache[Dict[str, Dict]]("compat_cache.json")

import React, { FC, useState, useEffect, useRef } from "react";
import { call, toaster } from "@decky/api";
import { showModal, ConfirmModal, DialogButton, Focusable } from "@decky/ui";
import { useTranslation } from "react-i18next";
import StoreIcon from "./StoreIcon";
import { UninstallConfirmModal } from "./UninstallConfirmModal";
import { updateSingleGameStatus } from "../tabs";

// Global cache for game info (5-second TTL for faster updates after installation)
const gameInfoCache = new Map<number, { info: any; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds - reduced from 30s for faster button state updates

// Install Info Display Component - shows download size next to play section
const InstallInfoDisplay: FC<{ appId: number }> = ({ appId }) => {
  const [gameInfo, setGameInfo] = useState<any>(null);
  const [processing, setProcessing] = useState(false);
  const [downloadState, setDownloadState] = useState<{
    isDownloading: boolean;
    progress?: number;
    downloadId?: string;
  }>({ isDownloading: false });
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { t } = useTranslation();

  // Fetch game info on mount
  useEffect(() => {
    const cached = gameInfoCache.get(appId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setGameInfo(cached.info);
      return;
    }

    call<[number], any>("get_game_info", appId)
      .then((info) => {
        const processedInfo = info?.error ? null : info;
        setGameInfo(processedInfo);
        gameInfoCache.set(appId, {
          info: processedInfo,
          timestamp: Date.now(),
        });
      })
      .catch(() => setGameInfo(null));
  }, [appId]);

  // Poll for download state when we have game info
  useEffect(() => {
    if (!gameInfo) return;

    const checkDownloadState = async () => {
      try {
        const result = await call<
          [string, string],
          {
            success: boolean;
            is_downloading: boolean;
            download_info?: {
              id: string;
              progress_percent: number;
              status: string;
            };
          }
        >("is_game_downloading", gameInfo.game_id, gameInfo.store);

        setDownloadState((prevState) => {
          const newState = {
            isDownloading: false,
            progress: 0,
            downloadId: undefined as string | undefined,
          };

          if (result.success && result.is_downloading && result.download_info) {
            const status = result.download_info.status;
            // Only show as downloading if status is actively downloading or queued
            // Cancelled/error items should not be shown as active downloads
            if (status === "downloading" || status === "queued") {
              newState.isDownloading = true;
              newState.progress = result.download_info.progress_percent;
              newState.downloadId = result.download_info.id;
            }
            // If status is cancelled/error/completed, isDownloading stays false
          }

          // Detect transition from Downloading -> Not Downloading (Completion)
          if (prevState.isDownloading && !newState.isDownloading) {
            console.log(
              "[InstallInfoDisplay] Download stopped, checking status...",
            );

            // Check the status from the download info to determine actual completion
            // result.download_info might be available even if is_downloading is false
            const finalStatus = result.download_info?.status;

            if (finalStatus === "completed") {
              console.log(
                "[InstallInfoDisplay] Download successfully finished",
              );

              // Show installation complete toast
              toaster.toast({
                title: t("toasts.installComplete"),
                body: t("toasts.installCompleteMessage", {
                  title: gameInfo?.title || "Game",
                }),
                duration: 10000,
                critical: true,
              });

              // Invalidate cache first to ensure fresh data
              gameInfoCache.delete(appId);

              // Refresh game info to update button state (Install -> Play/Uninstall)
              call<[number], any>("get_game_info", appId).then((info) => {
                const processedInfo = info?.error ? null : info;
                setGameInfo(processedInfo);
                if (processedInfo) {
                  gameInfoCache.set(appId, {
                    info: processedInfo,
                    timestamp: Date.now(),
                  });
                  // Update tab cache immediately so UI reflects change
                  updateSingleGameStatus({
                    appId,
                    store: processedInfo.store,
                    isInstalled: processedInfo.is_installed,
                  });
                }
              });
            } else if (finalStatus === "cancelled") {
              console.log(
                "[InstallInfoDisplay] Download was cancelled - suppressing success message",
              );
            } else if (finalStatus === "error") {
              console.log(
                "[InstallInfoDisplay] Download failed - suppressing success message",
              );
            } else {
              // Fallback: If no status info (legacy behavior or edge case), verify installation again
              console.log(
                "[InstallInfoDisplay] No final status, verifying installation...",
              );
              call<[number], any>("get_game_info", appId).then((info) => {
                if (info && info.is_installed) {
                  // It is installed, likely success
                  toaster.toast({
                    title: t("toasts.installComplete"),
                    body: t("toasts.installCompleteMessage", {
                      title: gameInfo?.title || "Game",
                    }),
                    duration: 10000,
                  });
                  setGameInfo(info);
                }
              });
            }
          }

          return newState;
        });
      } catch (error) {
        console.error(
          "[InstallInfoDisplay] Error checking download state:",
          error,
        );
      }
    };

    // Initial check
    checkDownloadState();

    // Poll every second when displaying
    pollIntervalRef.current = setInterval(checkDownloadState, 1000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [gameInfo, appId]);

  const handleInstall = async () => {
    if (!gameInfo) return;
    setProcessing(true);

    // Queue download instead of direct install
    const result = await call<[number], any>(
      "add_to_download_queue_by_appid",
      appId,
    );

    if (result.success) {
      toaster.toast({
        title: t("toasts.downloadStarted"),
        body: t("toasts.downloadQueued", { title: gameInfo.title }),
        duration: 5000,
      });

      // Show multi-part alert for GOG games with multiple installer parts
      if (result.is_multipart) {
        toaster.toast({
          title: t("toasts.multipartDetected"),
          body: t("toasts.multipartMessage"),
          duration: 8000,
        });
      }

      // Force immediate state check to update UI to "Cancel" faster
      setDownloadState((prev) => ({
        ...prev,
        isDownloading: true,
        progress: 0,
      }));
    } else {
      toaster.toast({
        title: t("toasts.downloadFailed"),
        body: result.error
          ? t(result.error)
          : t("toasts.downloadFailedMessage"),
        duration: 10000,
        critical: true,
      });
    }
    setProcessing(false);
  };

  const handleCancel = async () => {
    // If we don't have a specific download ID yet (race condition at start), try to construct it
    const dlId =
      downloadState.downloadId || `${gameInfo.store}:${gameInfo.game_id}`;

    setProcessing(true);

    const result = await call<[string], { success: boolean; error?: string }>(
      "cancel_download_by_id",
      dlId,
    );

    if (result.success) {
      toaster.toast({
        title: t("toasts.downloadCancelled"),
        body: t("toasts.downloadCancelledMessage", { title: gameInfo?.title }),
        duration: 5000,
      });
      setDownloadState({ isDownloading: false, progress: 0 });
    } else {
      toaster.toast({
        title: t("toasts.cancelFailed"),
        body: result.error ? t(result.error) : t("toasts.cancelFailedMessage"),
        duration: 5000,
        critical: true,
      });
    }
    setProcessing(false);
  };

  const handleUninstall = async (deletePrefix: boolean = false) => {
    if (!gameInfo) return;
    setProcessing(true);

    toaster.toast({
      title: t("toasts.uninstalling"),
      body: deletePrefix
        ? t("toasts.uninstallingMessageProton", { title: gameInfo.title })
        : t("toasts.uninstallingMessage", { title: gameInfo.title }),
      duration: 5000,
    });

    const result = await call<[number, boolean], any>(
      "uninstall_game_by_appid",
      appId,
      deletePrefix,
    );

    if (result.success) {
      setGameInfo({ ...gameInfo, is_installed: false });
      gameInfoCache.delete(appId);

      // Update tab cache immediately so UI reflects change without restart
      if (result.game_update) {
        updateSingleGameStatus(result.game_update);
      }

      toaster.toast({
        title: t("toasts.uninstallComplete"),
        body: deletePrefix
          ? t("toasts.uninstallCompleteMessageProton", {
              title: gameInfo.title,
            })
          : t("toasts.uninstallCompleteMessage", { title: gameInfo.title }),
        duration: 10000,
      });
    }
    // Note: Failure case removed - current logic handles all edge cases:
    // 1. Missing game files -> updates flag to not installed
    // 2. Missing mapping -> updates flag to not installed
    // 3. User clicks uninstall -> removes all flags/files
    setProcessing(false);
  };

  // Confirmation wrapper functions using native Steam modal
  const showInstallConfirmation = () => {
    showModal(
      <ConfirmModal
        strTitle={t("confirmModals.installTitle")}
        strDescription={t("confirmModals.installDescription", {
          title: gameInfo?.title,
        })}
        strOKButtonText={t("confirmModals.yes")}
        strCancelButtonText={t("confirmModals.no")}
        onOK={() => handleInstall()}
      />,
    );
  };

  const showUninstallConfirmation = () => {
    showModal(
      <UninstallConfirmModal
        gameTitle={gameInfo?.title || "this game"}
        onConfirm={(deletePrefix) => handleUninstall(deletePrefix)}
      />,
    );
  };

  const showCancelConfirmation = () => {
    showModal(
      <ConfirmModal
        strTitle={t("confirmModals.cancelTitle")}
        strDescription={t("confirmModals.cancelDescription", {
          title: gameInfo?.title,
        })}
        strOKButtonText={t("confirmModals.yes")}
        strCancelButtonText={t("confirmModals.no")}
        bDestructiveWarning={true}
        onOK={() => handleCancel()}
      />,
    );
  };

  // Not a Unifideck game - return null
  if (!gameInfo || gameInfo.error) return null;

  const isInstalled = gameInfo.is_installed;

  // Determine button display based on state
  let buttonText: string;
  let buttonAction: () => void;

  // Base button style - ROBUST AGAINST CSS MODS
  // Uses explicit colors and high specificity to override any Decky CSS themes
  const baseButtonStyle: React.CSSProperties = {
    padding: "10px 16px",
    minHeight: "44px",
    minWidth: "180px",
    fontSize: "14px",
    fontWeight: 600,
    borderRadius: "4px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    // Explicit visibility overrides for CSS mod resistance
    opacity: 1,
    visibility: "visible",
    // Remove any inherited transparency
    backdropFilter: "none",
    WebkitBackdropFilter: "none",
  };

  // Dynamic style based on state
  let buttonStyle: React.CSSProperties;

  if (downloadState.isDownloading) {
    // Show "Cancel" button with progress during active download
    // Use Math.max(0) to avoid negative -1 initialization
    const progress = Math.max(0, downloadState.progress || 0).toFixed(0);
    buttonText = `${t("installButton.cancel")} (${progress}%)`;
    buttonAction = showCancelConfirmation;

    buttonStyle = {
      ...baseButtonStyle,
      // Solid red background - highly visible
      backgroundColor: "#dc3545",
      color: "#ffffff",
      border: "2px solid #ff6b6b",
      boxShadow: "0 2px 8px rgba(220, 53, 69, 0.5)",
    };
  } else if (isInstalled) {
    // Show size for installed games if available
    const sizeText = gameInfo.size_formatted
      ? ` (${gameInfo.size_formatted})`
      : " (- GB)";
    buttonText =
      t("installButton.uninstall", { title: gameInfo.title }) + sizeText;
    buttonAction = showUninstallConfirmation;

    buttonStyle = {
      ...baseButtonStyle,
      // Solid gray/muted blue for uninstall
      backgroundColor: "#4a5568",
      color: "#ffffff",
      border: "2px solid #718096",
      boxShadow: "0 2px 8px rgba(74, 85, 104, 0.5)",
    };
  } else {
    // Show size in Install button
    const sizeText = gameInfo.size_formatted
      ? ` (${gameInfo.size_formatted})`
      : " (- GB)";
    buttonText =
      t("installButton.install", { title: gameInfo.title }) + sizeText;
    buttonAction = showInstallConfirmation;

    buttonStyle = {
      ...baseButtonStyle,
      // Solid blue background - Steam accent color, highly visible
      backgroundColor: "#1a9fff",
      color: "#ffffff",
      border: "2px solid #47b4ff",
      boxShadow: "0 2px 8px rgba(26, 159, 255, 0.5)",
    };
  }

  return (
    <>
      {" "}
      {/* Install/Uninstall/Cancel Button */}
      <Focusable
        style={{
          position: "absolute",
          top: "40px", // Aligned with ProtonDB badge row
          right: "35px",
          zIndex: 9999, // High z-index to ensure visibility above any overlays
          // Ensure focusable container is visible
          opacity: 1,
          visibility: "visible",
        }}
        // Ensure controller navigation works
        onActivate={buttonAction}
      >
        <DialogButton
          onClick={buttonAction}
          disabled={processing}
          style={buttonStyle}
          // Add focus visual feedback for controller users
          focusable={true}
        >
          {processing ? (
            t("installButton.processing")
          ) : (
            <>
              <StoreIcon store={gameInfo.store} size="16px" color="#ffffff" />
              {buttonText}
            </>
          )}
        </DialogButton>
      </Focusable>
    </>
  );
};

export default InstallInfoDisplay;

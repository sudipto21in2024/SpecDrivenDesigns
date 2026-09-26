import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import type { Shipment } from '../../api/client';

interface CancelShipmentDialogProps {
  open: boolean;
  /** The shipment to cancel; shown for confirmation so the action is never blind (AC-11). */
  shipment: Shipment | null;
  onClose: () => void;
  /**
   * Sends `POST /shipments/{id}/status-transitions` with `toStatus: "Cancelled"` (AC-8) and
   * resolves when it succeeds.
   */
  onConfirm: (note?: string) => Promise<void>;
}

/**
 * Cancel-shipment confirmation (LOGI-0008 AC-8/AC-11). The BR-7 transition itself is the LOGI-0006
 * endpoint — no new status-write path — but the UI must require an explicit confirmation before it
 * is sent, and the resulting 409 (the row moved on in another tab) is surfaced rather than swallowed.
 */
export default function CancelShipmentDialog({ open, shipment, onClose, onConfirm }: CancelShipmentDialogProps) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
      setSubmitting(false);
    }
  }, [open, shipment?.id]);

  const confirm = async () => {
    if (shipment == null) return;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(note);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.message)
          : 'Unexpected error. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Cancel shipment</DialogTitle>
      <DialogContent>
        {error != null && (
          <Alert severity="error" sx={{ mb: 2 }} role="alert">
            {error}
          </Alert>
        )}
        <DialogContentText sx={{ mb: 2 }}>
          {shipment == null
            ? 'Cancel this shipment?'
            : `Cancel shipment ${shipment.referenceCode}? It can only be cancelled while Pending or Assigned, and the cancellation is recorded in the audit trail.`}
        </DialogContentText>
        <TextField
          label="Note"
          fullWidth
          multiline
          minRows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          inputProps={{ 'aria-label': 'Cancellation note', maxLength: 500 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Keep shipment</Button>
        <Button
          onClick={() => void confirm()}
          color="error"
          variant="contained"
          disabled={submitting || shipment == null}
          data-testid="confirm-cancel"
        >
          Cancel shipment
        </Button>
      </DialogActions>
    </Dialog>
  );
}

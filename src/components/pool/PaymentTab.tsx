import { Copy, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const payment = {
  amount: import.meta.env.VITE_PAYMENT_AMOUNT || "Configure VITE_PAYMENT_AMOUNT",
  recipient: import.meta.env.VITE_PAYMENT_RECIPIENT || "Configure VITE_PAYMENT_RECIPIENT",
  methodLabel: import.meta.env.VITE_PAYMENT_METHOD_LABEL || "Payment method",
  keyLabel: import.meta.env.VITE_PAYMENT_KEY_LABEL || "Payment key",
  key: import.meta.env.VITE_PAYMENT_KEY || "Configure VITE_PAYMENT_KEY",
  bank: import.meta.env.VITE_PAYMENT_BANK || "Configure VITE_PAYMENT_BANK",
  instructions:
    import.meta.env.VITE_PAYMENT_INSTRUCTIONS ||
    "After payment, send the receipt to the pool organizer so your entry can be confirmed.",
};

export function PaymentTab() {
  const canCopy = Boolean(import.meta.env.VITE_PAYMENT_KEY);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <QrCode className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-bold uppercase tracking-tight">Pagamento do Bolão</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure esta aba com as instruções de pagamento do seu próprio bolão usando as variáveis
          <code className="mx-1 rounded bg-secondary px-1">VITE_PAYMENT_*</code> no arquivo{" "}
          <code>.env</code>.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="grid gap-6 md:grid-cols-2 md:items-center">
          <div className="flex justify-center">
            <div className="flex min-h-64 w-full max-w-xs items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Add your own QR code component or payment image here if your pool uses one.
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Valor</div>
              <div className="text-3xl font-black text-primary">{payment.amount}</div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Favorecido
              </div>
              <div className="text-lg font-bold">{payment.recipient}</div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {payment.keyLabel}
              </div>
              <div className="flex items-center gap-2">
                <span className="break-all font-mono text-base">{payment.key}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canCopy}
                  onClick={() => {
                    navigator.clipboard.writeText(payment.key);
                    toast.success("Chave copiada!");
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
                </Button>
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {payment.methodLabel}
              </div>
              <div className="text-sm">{payment.bank}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
        <strong>Importante:</strong> {payment.instructions}
      </section>
    </div>
  );
}

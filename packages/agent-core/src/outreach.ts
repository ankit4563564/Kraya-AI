import { formatINR, Paise } from '@kraya/finance-engine';

export type OutreachLanguage =
  | 'english'
  | 'hinglish'
  | 'hindi'
  | 'kannada'
  | 'tamil'
  | 'malayalam';

export type OutreachScenario =
  | 'rfq_request'
  | 'counter_offer'
  | 'invoice_dispute'
  | 'po_issued'
  | 'delivery_chase';

export interface OutreachDraftInput {
  scenario: OutreachScenario;
  language: OutreachLanguage;
  buyerCompany: string;
  supplierName: string;
  supplierPhone?: string | null;
  supplierEmail?: string | null;
  itemDescription?: string;
  quantity?: number;
  unit?: string;
  targetRatePaise?: Paise;
  quotedRatePaise?: Paise;
  poNumber?: string;
  invoiceNumber?: string;
  disputeAmountPaise?: Paise;
  disputeReasons?: string[];
  dueDate?: string;
  creditDays?: number;
}

export interface OutreachPackage {
  language: OutreachLanguage;
  subject: string;
  body: string;
  whatsappUrl: string;
  mailtoUrl: string;
}

export function formatIndianPhoneForWa(phone?: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function buildOutreachPackage(input: OutreachDraftInput): OutreachPackage {
  const { language, scenario, buyerCompany, supplierName } = input;
  const item = input.itemDescription || 'our required material';
  const qtyStr = input.quantity
    ? `${input.quantity.toLocaleString('en-IN')} ${input.unit || 'units'}`
    : 'required quantity';
  const targetStr = input.targetRatePaise ? formatINR(input.targetRatePaise) : '';
  const quotedStr = input.quotedRatePaise ? formatINR(input.quotedRatePaise) : '';
  const disputeStr = input.disputeAmountPaise ? formatINR(input.disputeAmountPaise) : '';
  const reasons = (input.disputeReasons ?? []).join('; ');

  let subject = `Procurement Inquiry — ${buyerCompany}`;
  let body = '';

  if (scenario === 'rfq_request') {
    subject = `RFQ: ${qtyStr} ${item} — ${buyerCompany}`;
    if (language === 'hinglish') {
      body = `Namaste ${supplierName} ji,\n\n${buyerCompany} ke liye humein ${qtyStr} ${item} chahiye${input.dueDate ? ` (${input.dueDate} tak delivery)` : ''}.\n\nKripya apna best rate share karein with:\n1. Base rate & GST %\n2. Freight / bhada (FOR ya Ex-factory)\n3. Credit terms & dispatch time\n\nDhanyavaad,\n${buyerCompany}`;
    } else if (language === 'hindi') {
      body = `नमस्ते ${supplierName} जी,\n\n${buyerCompany} के लिए हमें ${qtyStr} ${item} की आवश्यकता है${input.dueDate ? ` (डिलीवरी: ${input.dueDate} तक)` : ''}।\n\nकृपया अपना सर्वोत्तम कोटेशन भेजें:\n1. मूल दर और GST %\n2. भाड़ा / परिवहन शुल्क\n3. क्रेडिट अवधि और डिस्पैच समय\n\nधन्यवाद,\n${buyerCompany}`;
    } else if (language === 'kannada') {
      body = `ನಮಸ್ಕಾರ ${supplierName} ಅವರೇ,\n\n${buyerCompany} ಸಂಸ್ಥೆಗಾಗಿ ನಮಗೆ ${qtyStr} ${item} ಅಗತ್ಯವಿದೆ${input.dueDate ? ` (${input.dueDate} ರೊಳಗೆ ಡೆಲಿವರಿ)` : ''}.\n\nದಯವಿಟ್ಟು ನಿಮ್ಮ ಉತ್ತಮ ಕೊಟೇಶನ್ ಕಳುಹಿಸಿ:\n1. ಮೂಲ ದರ ಮತ್ತು GST %\n2. ಸಾಗಣೆ / ಬಾಡಿಗೆ ವೆಚ್ಚ (FOR ಅಥವಾ Ex-factory)\n3. ಕ್ರೆಡಿಟ್ ದಿನಗಳು ಮತ್ತು ಡಿಸ್ಪ್ಯಾಚ್ ಸಮಯ\n\nಧನ್ಯವಾದಗಳು,\n${buyerCompany}`;
    } else if (language === 'tamil') {
      body = `வணக்கம் ${supplierName} அவர்களே,\n\n${buyerCompany} நிறுவனத்திற்காக ${qtyStr} ${item} தேவைப்படுகிறது${input.dueDate ? ` (டெலிவரி: ${input.dueDate}க்குள்)` : ''}.\n\nதயவுசெய்து உங்கள் சிறந்த விலைப் பட்டியலை (Quotation) அனுப்பவும்:\n1. அடிப்படை விலை மற்றும் GST %\n2. போக்குவரத்து / வாடகை (FOR அல்லது Ex-factory)\n3. கிரெடிட் நாட்கள் மற்றும் அனுப்பும் தேதி\n\nநன்றி,\n${buyerCompany}`;
    } else if (language === 'malayalam') {
      body = `നമസ്കാരം ${supplierName},\n\n${buyerCompany}-ലേക്ക് ${qtyStr} ${item} ആവശ്യമാണ്${input.dueDate ? ` (ഡെലിവറി: ${input.dueDate}-ന് മുമ്പ്)` : ''}.\n\nദയവായി നിങ്ങളുടെ മികച്ച ക്വട്ടേഷൻ അയച്ചുതരിക:\n1. യൂണിറ്റ് നിരക്കും GST % ഉം\n2. ട്രാൻസ്പോർട്ട് / ലോറി വാടക (FOR / Ex-factory)\n3. ക്രെഡിറ്റ് ദിവസങ്ങളും ഡിസ്പാച്ച് സമയവും\n\nനന്ദി,\n${buyerCompany}`;
    } else {
      body = `Hello ${supplierName},\n\nWe need a quotation for ${qtyStr} of ${item}${input.dueDate ? ` (target delivery: ${input.dueDate})` : ''}.\n\nPlease share your best offer including:\n1. Unit rate & applicable GST %\n2. Freight terms (FOR destination vs. Ex-factory)\n3. Payment credit days & earliest dispatch date\n\nRegards,\n${buyerCompany}`;
    }
  } else if (scenario === 'counter_offer') {
    subject = `Rate Revision Request: ${item} — ${buyerCompany}`;
    if (language === 'hinglish') {
      body = `Namaste ${supplierName} ji,\n\n${item} ke quote ke liye dhanyavaad. Aapka current rate ${quotedStr} hamare pichle order / target benchmark (${targetStr}) se kaafi zyada hai.\n\nHum regular volume ke saath long-term kaam karna chahte hain. Agar aap ${targetStr}${input.creditDays ? ` with ${input.creditDays}-day credit` : ''} match kar sakein, toh hum aaj hi PO release kar sakte hain.\n\nRegards,\n${buyerCompany}`;
    } else if (language === 'hindi') {
      body = `नमस्ते ${supplierName} जी,\n\n${item} के कोटेशन के लिए धन्यवाद। आपकी वर्तमान दर ${quotedStr} हमारे पिछले ऑर्डर / लक्ष्य दर (${targetStr}) से अधिक है।\n\nयदि आप ${targetStr}${input.creditDays ? ` (${input.creditDays} दिन क्रेडिट के साथ)` : ''} पर सहमति दे सकें, तो हम आज ही PO जारी कर सकते हैं।\n\nधन्यवाद,\n${buyerCompany}`;
    } else if (language === 'kannada') {
      body = `ನಮಸ್ಕಾರ ${supplierName} ಅವರೇ,\n\n${item} ಕೊಟೇಶನ್ ಕಳುಹಿಸಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ನೀವು ನೀಡಿರುವ ದರ (${quotedStr}) ನಮ್ಮ ಹಿಂದಿನ ಆರ್ಡರ್ / ಗುರಿ ದರಕ್ಕಿಂತ (${targetStr}) ಹೆಚ್ಚಾಗಿದೆ.\n\nನಾವು ನಿರಂತರವಾಗಿ ದೀರ್ಘಕಾಲದ ಆರ್ಡರ್‌ಗಳನ್ನು ನೀಡಲು ಬಯಸುತ್ತೇವೆ. ನೀವು ${targetStr}${input.creditDays ? ` (${input.creditDays} ದಿನಗಳ ಕ್ರೆಡಿಟ್‌ನೊಂದಿಗೆ)` : ''} ದರಕ್ಕೆ ಒಪ್ಪಿದರೆ, ಇಂದೇ PO ಬಿಡುಗಡೆ ಮಾಡಲು ಸಿದ್ಧರಿದ್ದೇವೆ.\n\nಧನ್ಯವಾದಗಳು,\n${buyerCompany}`;
    } else if (language === 'tamil') {
      body = `வணக்கம் ${supplierName} அவர்களே,\n\n${item} விலைப் பட்டியலுக்கு நன்றி. நீங்கள் கொடுத்த விலை (${quotedStr}) எங்கள் முந்தைய ஆர்டர் / இலக்கு விலையை (${targetStr}) விட அதிகமாக உள்ளது.\n\nதொடர்ந்து நீண்டகால ஆர்டர்கள் கொடுக்க விரும்புகிறோம். ${targetStr}${input.creditDays ? ` (${input.creditDays} நாட்கள் கிரெடிட் உடன்)` : ''} விலையில் கொடுக்க முடிந்தால், இன்றே PO வெளியிட தயாராக உள்ளோம்.\n\nநன்றி,\n${buyerCompany}`;
    } else if (language === 'malayalam') {
      body = `നമസ്കാരം ${supplierName},\n\n${item}-ന്റെ ക്വട്ടേഷന് നന്ദി. നിങ്ങൾ നൽകിയ നിരക്ക് (${quotedStr}) ഞങ്ങളുടെ കഴിഞ്ഞ ഓർഡർ / ടാർഗെറ്റ് നിരക്കിനേക്കാൾ (${targetStr}) കൂടുതലാണ്.\n\nതുടർച്ചയായ ഓർഡറുകൾ നൽകാൻ ഞങ്ങൾ ആഗ്രഹിക്കുന്നു. ${targetStr}${input.creditDays ? ` (${input.creditDays} ദിവസത്തെ ക്രെഡിറ്റോടെ)` : ''} നിരക്കിൽ നൽകാൻ സാധിച്ചാൽ ഇന്നുതന്നെ PO അയയ്ക്കാം.\n\nനന്ദി,\n${buyerCompany}`;
    } else {
      body = `Hello ${supplierName},\n\nThank you for your quote on ${item}. We noticed the quoted rate (${quotedStr}) is above our previous order benchmark (${targetStr}).\n\nWe value our ongoing relationship and are ready to release the PO today if you can match ${targetStr}${input.creditDays ? ` on ${input.creditDays}-day credit terms` : ''}.\n\nRegards,\n${buyerCompany}`;
    }
  } else if (scenario === 'invoice_dispute') {
    subject = `Invoice Verification Hold: ${input.invoiceNumber || 'Recent Bill'} — ${buyerCompany}`;
    if (language === 'hinglish') {
      body = `Namaste ${supplierName} ji,\n\nInvoice #${input.invoiceNumber || ''} verify karte waqt humne ${disputeStr} ka mismatch dekha hai:\n• ${reasons || 'Rate / GST / quantity discrepancy vs PO'}\n\nJab tak revised invoice / Credit Note nahi milta, humne is bill ko GST IMS portal par Pending rakha hai. Kripya jaldi clarify/correct karein taaki hum payment time par release kar sakein.\n\nDhanyavaad,\n${buyerCompany}`;
    } else if (language === 'hindi') {
      body = `नमस्ते ${supplierName} जी,\n\nइनवॉइस #${input.invoiceNumber || ''} की जांच में ${disputeStr} का अंतर पाया गया है:\n• ${reasons || 'दर / GST / मात्रा में अंतर'}\n\nकृपया संशोधित इनवॉइस या क्रेडिट नोट जारी करें। सुधार के बाद हम तुरंत भुगतान जारी कर देंगे।\n\nधन्यवाद,\n${buyerCompany}`;
    } else if (language === 'kannada') {
      body = `ನಮಸ್ಕಾರ ${supplierName} ಅವರೇ,\n\nಇನ್‌ವಾಯ್ಸ್ #${input.invoiceNumber || ''} ಪರಿಶೀಲಿಸುವಾಗ ${disputeStr} ವ್ಯತ್ಯಾಸ ಕಂಡುಬಂದಿದೆ:\n• ${reasons || 'PO ದರ / GST / ಪ್ರಮಾಣದಲ್ಲಿ ವ್ಯತ್ಯಾಸ'}\n\nಪರಿಷ್ಕೃತ ಇನ್‌ವಾಯ್ಸ್ ಅಥವಾ Credit Note ಸಿಗುವವರೆಗೆ ಈ ಬಿಲ್ ಅನ್ನು GST IMS ಪೋರ್ಟಲ್‌ನಲ್ಲಿ Pending ಇರಿಸಿದ್ದೇವೆ. ದಯವಿಟ್ಟು ಶೀಘ್ರದಲ್ಲಿ ಸರಿಪಡಿಸಿ ಕಳುಹಿಸಿದರೆ, ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ಪಾವತಿ ಮಾಡಲಾಗುತ್ತದೆ.\n\nಧನ್ಯವಾದಗಳು,\n${buyerCompany}`;
    } else if (language === 'tamil') {
      body = `வணக்கம் ${supplierName} அவர்களே,\n\nபில் / இன்வாய்ஸ் #${input.invoiceNumber || ''} சரிபார்த்தபோது ${disputeStr} வித்தியாசம் கண்டறியப்பட்டுள்ளது:\n• ${reasons || 'PO விலை / GST / அளவு வேறுபாடு'}\n\nதிருத்தப்பட்ட இன்வாய்ஸ் அல்லது Credit Note கிடைக்கும் வரை இதை GST IMS-ல் Pending-ஆக வைத்துள்ளோம். தயவுசெய்து விரைவில் சரிசெய்து அனுப்பினால், பணம் உடனடியாக செலுத்தப்படும்.\n\nநன்றி,\n${buyerCompany}`;
    } else if (language === 'malayalam') {
      body = `നമസ്കാരം ${supplierName},\n\nഇൻവോയ്സ് #${input.invoiceNumber || ''} പരിശോധിച്ചപ്പോൾ ${disputeStr}-ന്റെ വ്യത്യാസം കണ്ടെത്തിയിട്ടുണ്ട്:\n• ${reasons || 'PO നിരക്ക് / GST / അളവ് വ്യത്യാസം'}\n\nതിരുത്തിയ ഇൻവോയ്സ് അല്ലെങ്കിൽ ക്രെഡിറ്റ് നോട്ട് ലഭിക്കുന്നതുവരെ ഈ ബിൽ GST IMS പോർട്ടലിൽ Pending ആയി വച്ചിരിക്കുകയാണ്. വേഗത്തിൽ ശരിയാക്കി അയച്ചാൽ പെയ്മെന്റ് കൃത്യസമയത്ത് നൽകാം.\n\nനന്ദി,\n${buyerCompany}`;
    } else {
      body = `Hello ${supplierName},\n\nDuring pre-payment verification of Invoice #${input.invoiceNumber || ''}, we flagged a discrepancy of ${disputeStr}:\n• ${reasons || 'Rate / GST / quantity mismatch against agreed PO'}\n\nWe have kept this invoice on hold (and Pending in GST IMS) pending a revised invoice / Credit Note. Please rectify at the earliest so we can release payment on time.\n\nRegards,\n${buyerCompany}`;
    }
  } else if (scenario === 'po_issued') {
    subject = `Purchase Order ${input.poNumber || ''} Issued — ${buyerCompany}`;
    if (language === 'hinglish') {
      body = `Namaste ${supplierName} ji,\n\nPO #${input.poNumber || ''} (${qtyStr} ${item}) approve aur issue ho gaya hai${input.creditDays !== undefined ? ` — Payment Terms: Net ${input.creditDays} Days` : ''}${input.dueDate ? `, Delivery Due: ${input.dueDate}` : ''}.\n\nKripya PO PDF confirm karein aur dispatch schedule share karein.\n\nDhanyavaad,\n${buyerCompany}`;
    } else if (language === 'hindi') {
      body = `नमस्ते ${supplierName} जी,\n\nPO #${input.poNumber || ''} (${qtyStr} ${item}) जारी कर दिया गया है${input.creditDays !== undefined ? ` — भुगतान शर्तें: ${input.creditDays} दिन` : ''}${input.dueDate ? `, डिलीवरी तिथि: ${input.dueDate}` : ''}।\n\nकृपया PO की पुष्टि करें और डिस्पैच की तारीख बताएं।\n\nधन्यवाद,\n${buyerCompany}`;
    } else if (language === 'kannada') {
      body = `ನಮಸ್ಕಾರ ${supplierName} ಅವರೇ,\n\nPO #${input.poNumber || ''} (${qtyStr} ${item}) ಅನುಮೋದಿಸಿ ಕಳುಹಿಸಲಾಗಿದೆ${input.creditDays !== undefined ? ` — ಪಾವತಿ ಅವಧಿ: ${input.creditDays} ದಿನಗಳು` : ''}${input.dueDate ? `, ಡೆಲಿವರಿ ದಿನಾಂಕ: ${input.dueDate}` : ''}.\n\nದಯವಿಟ್ಟು PO ದೃಢೀಕರಿಸಿ ಮತ್ತು ಡಿಸ್ಪ್ಯಾಚ್ ವಿವರಗಳನ್ನು ಹಂಚಿಕೊಳ್ಳಿ.\n\nಧನ್ಯವಾದಗಳು,\n${buyerCompany}`;
    } else if (language === 'tamil') {
      body = `வணக்கம் ${supplierName} அவர்களே,\n\nPO #${input.poNumber || ''} (${qtyStr} ${item}) உறுதி செய்யப்பட்டு அனுப்பப்பட்டுள்ளது${input.creditDays !== undefined ? ` — கட்டண விதிமுறை: ${input.creditDays} நாட்கள்` : ''}${input.dueDate ? `, டெலிவரி தேதி: ${input.dueDate}` : ''}.\n\nதயவுசெய்து PO-வை உறுதிப்படுத்தி டிஸ்பாட்ச் விவரங்களை பகிரவும்.\n\nநன்றி,\n${buyerCompany}`;
    } else if (language === 'malayalam') {
      body = `നമസ്കാരം ${supplierName},\n\nPO #${input.poNumber || ''} (${qtyStr} ${item}) അംഗീകരിച്ച് അയച്ചിട്ടുണ്ട്${input.creditDays !== undefined ? ` — പെയ്മെന്റ് നിബന്ധന: ${input.creditDays} ദിവസം` : ''}${input.dueDate ? `, ഡെലിവറി തീയതി: ${input.dueDate}` : ''}.\n\nദയവായി PO സ്ഥിരീകരിച്ച് ഡിസ്പാച്ച് വിവരങ്ങൾ അറിയിക്കുക.\n\nനന്ദി,\n${buyerCompany}`;
    } else {
      body = `Hello ${supplierName},\n\nPurchase Order #${input.poNumber || ''} for ${qtyStr} of ${item} has been issued${input.creditDays !== undefined ? ` (Written Payment Terms: Net ${input.creditDays} Days)` : ''}${input.dueDate ? `, Delivery Due: ${input.dueDate}` : ''}.\n\nPlease acknowledge receipt of the PO PDF and share the dispatch details.\n\nRegards,\n${buyerCompany}`;
    }
  } else {
    // delivery_chase
    subject = `Dispatch Follow-Up: PO ${input.poNumber || ''} — ${buyerCompany}`;
    if (language === 'hinglish') {
      body = `Namaste ${supplierName} ji,\n\nPO #${input.poNumber || ''} (${item}) ki delivery ${input.dueDate || 'due'} hai. Kripya aaj ka dispatch status aur LR / Bilty number share kar dijiye.\n\nDhanyavaad,\n${buyerCompany}`;
    } else if (language === 'hindi') {
      body = `नमस्ते ${supplierName} जी,\n\nPO #${input.poNumber || ''} (${item}) की डिलीवरी ${input.dueDate || 'लंबित'} है। कृपया आज का डिस्पैच स्टेटस और बिल्टी (LR) नंबर साझा करें।\n\nधन्यवाद,\n${buyerCompany}`;
    } else if (language === 'kannada') {
      body = `ನಮಸ್ಕಾರ ${supplierName} ಅವರೇ,\n\nPO #${input.poNumber || ''} (${item}) ಡೆಲಿವರಿ ${input.dueDate || 'ಬಾಕಿ ಇದೆ'}. ದಯವಿಟ್ಟು ಇಂದಿನ ಡಿಸ್ಪ್ಯಾಚ್ ಸ್ಥಿತಿ ಮತ್ತು LR / ಬಿಲ್ಟಿ ಸಂಖ್ಯೆಯನ್ನು ಹಂಚಿಕೊಳ್ಳಿ.\n\nಧನ್ಯವಾದಗಳು,\n${buyerCompany}`;
    } else if (language === 'tamil') {
      body = `வணக்கம் ${supplierName} அவர்களே,\n\nPO #${input.poNumber || ''} (${item}) டெலிவரி ${input.dueDate || 'நிலுவையில்'} உள்ளது. தயவுசெய்து இன்றைய டிஸ்பாட்ச் நிலை மற்றும் LR / Bilty எண்ணை பகிரவும்.\n\nநன்றி,\n${buyerCompany}`;
    } else if (language === 'malayalam') {
      body = `നമസ്കാരം ${supplierName},\n\nPO #${input.poNumber || ''} (${item}) ഡെലിവറി ${input.dueDate || 'ബാക്കിയാണ്'}. ദയവായി ഇന്നത്തെ ഡിസ്പാച്ച് വിവരങ്ങളും LR / Bilty നമ്പറും അയച്ചുതരിക.\n\nനന്ദി,\n${buyerCompany}`;
    } else {
      body = `Hello ${supplierName},\n\nFollowing up on PO #${input.poNumber || ''} (${item}), due ${input.dueDate || 'shortly'}. Kindly share today's dispatch status and transporter LR / Bilty copy.\n\nRegards,\n${buyerCompany}`;
    }
  }

  const waPhone = formatIndianPhoneForWa(input.supplierPhone);
  const encodedBody = encodeURIComponent(body);
  const whatsappUrl = waPhone
    ? `https://wa.me/${waPhone}?text=${encodedBody}`
    : `https://wa.me/?text=${encodedBody}`;

  const mailtoUrl = `mailto:${encodeURIComponent(input.supplierEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodedBody}`;

  return {
    language,
    subject,
    body,
    whatsappUrl,
    mailtoUrl,
  };
}

/* Adds a few sample patients the first time the local preview opens. */
(function () {
  'use strict';
  if (getPatients().length) return;
  const day = n => {
    const d = new Date(Date.now() + n * 864e5);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const samples = [
    { name: 'Mohamed Abdelrahman', phone: '01012345678', hospital: 'El Sahel', consultant: 'Dr Ahmed Elghity', classification: 'Vascular', status: 'Waiting for labs', procedure: 'AV fistula', age: '54', hint: 'Diabetic — needs HbA1c', anesthesia: { items: { CBC: true, ECG: true }, fitness: 'Pending' } },
    { name: 'فاطمة السيد', phone: '01122334455', hospital: 'El Mabara', consultant: 'Dr Alaa Ahmed', classification: 'Spine', status: 'Ready for surgery', procedure: 'L4-L5 discectomy', surgeryDate: day(2), anesthesia: { items: { CBC: true, ECG: true, 'Chest X-ray': true, 'Consent signed': true }, asa: 'ASA II', fitness: 'Fit' } },
    { name: 'Ahmed Mahmoud', phone: '01598765432', hospital: '15th of May', consultant: 'General', classification: 'Vascular', status: 'Waiting for paperwork', hint: 'Insurance approval pending' },
    { name: 'Sara Kamal', phone: '01234567890', hospital: 'El Sahel', consultant: 'Dr Alaa Ahmed', classification: 'Spine', status: 'Done', surgeryDate: day(-3), procedure: 'Lumbar fixation' },
  ];
  samples.forEach(s => createPatient(s));
})();
